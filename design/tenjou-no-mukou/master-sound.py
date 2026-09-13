"""Build 48 kHz stereo PCM masters from the CC0 recordings in audio/CREDITS.md.
Usage: python master-sound.py <directory-containing-*-source.mp3>
Requires numpy and the installed ffmpeg. No network access or generated-image edits.
"""
import json, pathlib, subprocess, sys, wave
import numpy as np

SR = 48000
source = pathlib.Path(sys.argv[1])
out = pathlib.Path(__file__).resolve().parents[2] / 'public/comics/tenjou-no-mukou/audio'
out.mkdir(parents=True, exist_ok=True)
metrics = []

def read(name):
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(source / (name+'-source.mp3')), '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'])
    return np.frombuffer(raw, dtype='<f4').reshape(-1, 2).astype(float)

def stretch(x, rate):
    t = np.arange(0, len(x)-1, rate)
    return np.stack([np.interp(t, np.arange(len(x)), x[:, c]) for c in range(2)], axis=1)

def shape(x, lo=45, hi=16000, boosts=()):
    n = len(x)
    f = np.fft.rfftfreq(n, 1/SR)
    response = (1-np.exp(-(f/lo)**4)) * np.exp(-(f/hi)**8)
    for center, width, db in boosts:
        response *= 10**((db*np.exp(-.5*((f-center)/width)**2))/20)
    return np.fft.irfft(np.fft.rfft(x, axis=0)*response[:, None], n=n, axis=0)

def normal(x, peak=.8):
    return x * peak / max(1e-9, np.abs(x).max())

def fade(x, onset=.003, tail=.08):
    x = x.copy()
    n, m = min(len(x), int(onset*SR)), min(len(x), int(tail*SR))
    if n: x[:n] *= np.linspace(0, 1, n)[:, None]
    if m: x[-m:] *= np.linspace(1, 0, m)[:, None]
    return x

def mix_at(dest, x, at, gain=1):
    a = int(at*SR)
    size = min(len(x), len(dest)-a)
    if size > 0: dest[a:a+size] += x[:size]*gain

def reflections(x, taps):
    y = x.copy()
    for time, gain, swap in taps:
        n = int(time*SR)
        if n < len(x): y[n:] += x[:-n, ::-1] * gain if swap else x[:-n]*gain
    return y

def save(name, x, peak):
    x = fade(normal(x, peak))
    rng = np.random.default_rng(76012)
    pcm = np.clip(x + (rng.random(x.shape)-rng.random(x.shape))/65536, -1, 1)
    with wave.open(str(out/(name+'.wav')), 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((pcm*32767).astype('<i2').tobytes())
    metrics.append(dict(name=name, seconds=round(len(x)/SR, 4), peak=round(float(abs(x).max()), 6), rms=round(float(np.sqrt(np.mean(x*x))), 6), stereoDifference=round(float(np.sqrt(np.mean((x[:,0]-x[:,1])**2))), 6)))

# Keep the plate's complex initial transient and tumbling fragments; close/dry stereo.
plate = read('plate')
ceramic = read('ceramic')
shatter = np.zeros((int(2.05*SR), 2))
mix_at(shatter, plate, 0, .94)
mix_at(shatter, ceramic[int(1.68*SR):int(2.65*SR)], .24, .30)
mix_at(shatter, ceramic[int(3.75*SR):int(4.5*SR), ::-1], .77, .24)
shatter = shape(shatter, 55, 17500, [(3200, 2200, 1.6)])
save('shatter', reflections(shatter, [(.018,.10,True),(.037,.05,False)]), .88)

# Actual mechanical hammer/bell recording, two insistent bursts with metal decay.
raw_phone = read('phone')
ring = fade(raw_phone[int(.585*SR):int(2.48*SR)], .002, .035)
phone = np.zeros((int(4.6*SR), 2))
mix_at(phone, ring, 0)
mix_at(phone, ring, 2.02, .98)
phone = shape(phone, 180, 11500, [(1700,900,2.2)])
save('phone', reflections(phone, [(.013,.12,True),(.043,.08,False)]), .84)

# The load bends an old board; lower pitch and preserve the long stick/slip creak.
wood = stretch(read('wood')[:int(1.2*SR)], .77)
wood = shape(wood, 48, 6500, [(290,170,3.8),(950,500,1.7)])
t = np.arange(len(wood))/SR
weight = .015*np.sin(2*np.pi*(79*t-15*t*t))*np.exp(-t*8)
wood += weight[:,None]
save('wood', reflections(wood, [(.028,.12,True),(.067,.07,False)]), .78)

# Original mix of CC0 performed groans: irregular throat pulses and an open A vowel.
# This uses no film soundtrack, actor voice clone, or licensed character recording.
length = int(2.3*SR)
voice = normal(read('voice')[int(.13*SR):int(.13*SR)+length], .55)
groan = normal(stretch(read('groan')[int(.15*SR):], .82)[:length], .42)
t = np.arange(length)/SR
freq = 78 + 7*np.sin(2*np.pi*1.7*t) + 4*np.sin(2*np.pi*13.1*t)
phase = np.cumsum(freq)/SR
pulse = np.exp(-((phase%1)/.105)**2) - .09
vowel = np.zeros(length)
for center, width, gain in [(730,150,1),(1120,220,.72),(2450,360,.26)]:
    f = np.fft.rfftfreq(length, 1/SR)
    vowel += np.fft.irfft(np.fft.rfft(pulse)*np.exp(-.5*((f-center)/width)**2), n=length)*gain
vowel /= max(1e-9, abs(vowel).max())
syllables = (.25+.75*(.5+.5*np.sin(2*np.pi*(6.9*t+.21*np.sin(2*np.pi*1.4*t))))**.8)
gravel = .65+.35*np.sin(2*np.pi*31.7*t+.6*np.sin(2*np.pi*3.1*t))
voice = (voice*.74 + groan*.52 + vowel[:,None]*.22)*syllables[:,None]*gravel[:,None]
voice = shape(np.tanh(voice*2.4), 68, 7500, [(680,350,2.0)])
voice = reflections(voice, [(.019,-.16,True),(.057,.13,False),(.103,.055,True)])
save('voice', voice, .83)
print(json.dumps(metrics, indent=2))
