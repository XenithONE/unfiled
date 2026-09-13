import { ComicSound } from './sound.js';

const $ = (selector) => document.querySelector(selector);
const body = document.body;
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const frames = [
  { cell: 0, hold: 240, caption: '奥に、うつむいた人影。' },
  { cell: 1, hold: 250, cue: 'head', caption: '顔が、こちらを向く。' },
  { cell: 2, hold: 210, cue: 'step', caption: '片手が、前の床板をつかむ。' },
  { cell: 3, hold: 175, cue: 'step', caption: '身体を低くして、這い寄る。' },
  { cell: 4, hold: 150, cue: 'step', caption: '膝を引きつけ、床を蹴る。' },
  { cell: 5, hold: 125, cue: 'rush', caption: '片腕を伸ばしながら、飛びかかる。' },
  { cell: 6, hold: 105, cue: 'rush', caption: '指が、こちらをつかもうと開く。' },
  { cell: 7, hold: 85, cue: 'rush', caption: '顔と手が、目の前へ。' },
  { cell: 8, hold: 720, cue: 'impact', caption: '——つかまえた。' },
];
let phase = 'idle';
let started = false;
let soundEnabled = true;
let motionEnabled = !motionQuery.matches;
let synth;
let audioContext;
let artReady = false;
let artFailed = false;
let consumed = false;
let raf = 0;
let blackoutTimer = 0;
let frameIndex = -1;
let frameDeadline = 0;
let discoverySince = 0;
let armedAt = 0;
let lastWheel = -Infinity;
let touchStartY = 0;
let touchEligible = false;
let touchUsed = false;
let lastWidth = innerWidth;
const cuesSeen = new Set();
const cuePanels = [...document.querySelectorAll('[data-cue]')];
const status = $('#reader-status');
const approach = $('#approach');
const ending = $('#ending');
const gallery = $('#frame-gallery');
const discovery = $('#discovery');

function setPhase(next) { phase = next; body.dataset.phase = next; }
function syncControls() {
  body.dataset.motion = motionEnabled ? 'on' : 'off';
  $('#motion-toggle').setAttribute('aria-pressed', String(motionEnabled));
  $('#motion-toggle span').textContent = motionEnabled ? 'ON' : 'OFF';
  $('#sound-toggle').setAttribute('aria-pressed', String(soundEnabled));
  $('#sound-toggle span').textContent = soundEnabled ? 'ON' : 'OFF';
}

function artElement(index) {
  const div = document.createElement('div');
  div.className = 'attack-art ' + (index === frames.length - 1 ? 'final-art' : 'atlas-cell');
  div.style.setProperty('--col', frames[index].cell % 3);
  div.style.setProperty('--row', Math.floor(frames[index].cell / 3));
  div.setAttribute('role', 'img');
  div.setAttribute('aria-label', frames[index].caption);
  return div;
}
frames.forEach((frame, index) => {
  const step = document.createElement('div');
  step.className = 'attack-step'; step.dataset.frame = index;
  step.append(artElement(index)); approach.append(step);
  const figure = document.createElement('figure');
  const caption = document.createElement('figcaption');
  caption.textContent = `${String(index + 1).padStart(2, '0')}　${frame.caption}`;
  const art = artElement(index);
  if (index === 5 || index === 6) art.style.transform = 'scaleX(-1)';
  figure.append(art, caption); gallery.append(figure);
});
const steps = [...approach.children];

function decodeAsset(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => reject(new Error(`Image timeout: ${src}`)), 15000);
    image.onload = () => {
      image.decode().then(() => { clearTimeout(timer); resolve(image); }, (error) => { clearTimeout(timer); reject(error); });
    };
    image.onerror = () => { clearTimeout(timer); reject(new Error(`Image failed: ${src}`)); };
    image.src = src;
  });
}
const artPromise = Promise.all(['attack', 'final', 'phone', 'listen'].map(name => decodeAsset(`./art/${name}.webp`)))
  .then(images => {
    // Retain decoded images for the entire reading session.
    artPromise.images = images;
    artReady = true;
    $('#load-status').textContent = '';
    $('#loading-fallback').hidden = true;
  }).catch(() => {
    artFailed = true;
    motionEnabled = false;
    syncControls();
    $('#load-status').textContent = '一部の絵を読み込めませんでした。自動演出なしで読めます。';
    status.textContent = '絵の読み込みに失敗したため、自動演出を停止しました。';
    if (started) showStatic();
  });

async function unlockSound() {
  if (!soundEnabled) return;
  try {
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('Audio unavailable');
      audioContext = new AudioContextClass();
      synth = new ComicSound(audioContext);
    }
    synth.setEnabled(true);
    if (audioContext.state === 'suspended') await audioContext.resume();
  } catch {
    soundEnabled = false; syncControls();
    status.textContent = 'このブラウザでは音を開始できませんでした。漫画はそのまま読めます。';
  }
}

function scrollToElement(element) {
  window.scrollTo({ top: element.getBoundingClientRect().top + scrollY, left: 0, behavior: 'instant' });
}
function begin(quiet = false) {
  cancelAnimation();
  consumed = false; started = true; cuesSeen.clear();
  discoverySince = 0; armedAt = 0; frameIndex = -1;
  delete body.dataset.frame;
  lastWheel = -Infinity; touchEligible = false;
  approach.hidden = true; gallery.hidden = true; ending.hidden = true;
  $('#frames-toggle').setAttribute('aria-expanded', 'false');
  $('#loading-fallback').hidden = true;
  if (quiet) { soundEnabled = false; motionEnabled = false; }
  syncControls();
  synth?.stop(); synth?.setEnabled(soundEnabled);
  void unlockSound();
  setPhase('reading');
  if (!motionEnabled || artFailed) showStatic();
  scrollToElement($('#story'));
  $('#story').focus({ preventScroll: true });
  status.textContent = motionEnabled ? '読み始めました。下へスクロールして読んでください。' : '音と自動演出を抑えて読み始めました。';
}

function cancelAnimation() {
  cancelAnimationFrame(raf); raf = 0;
  clearTimeout(blackoutTimer); blackoutTimer = 0;
  $('#stop').hidden = true; $('#blackout').hidden = true;
  document.documentElement.removeAttribute('data-controlled');
  synth?.stop();
}
function showStatic() {
  approach.hidden = false; ending.hidden = false;
  approach.classList.add('static-sequence');
  if (phase !== 'idle') setPhase('static');
}
function stopAttack(reason = '演出を停止しました。コマを自分のペースで読めます。') {
  const wasAttacking = phase === 'attacking' || phase === 'blackout';
  const savedFrame = Math.max(0, frameIndex);
  cancelAnimation();
  consumed = true; motionEnabled = false; syncControls();
  showStatic();
  if (wasAttacking) scrollToElement(steps[savedFrame]);
  status.textContent = reason;
}
function finishAttack() {
  cancelAnimation();
  approach.hidden = true; ending.hidden = false;
  setPhase('ending');
  scrollToElement(ending);
  $('#replay').focus({ preventScroll: true });
  status.textContent = 'おわり。もう一度読むことも、連続コマをゆっくり見返すこともできます。';
}
function displayFrame(index, now) {
  frameIndex = index;
  body.dataset.frame = String(index);
  scrollToElement(steps[index]);
  if (frames[index].cue) synth?.play(frames[index].cue);
  frameDeadline = now + frames[index].hold;
}
function advance(now) {
  if (phase !== 'attacking') return;
  if (document.hidden) { stopAttack(); return; }
  if (now >= frameDeadline) {
    if (frameIndex < frames.length - 1) displayFrame(frameIndex + 1, now);
    else {
      setPhase('blackout');
      synth?.stop();
      $('#blackout').hidden = false;
      blackoutTimer = setTimeout(finishAttack, 900);
      return;
    }
  }
  raf = requestAnimationFrame(advance);
}
function attack() {
  if (!started || consumed || !motionEnabled || !artReady || document.hidden) return false;
  consumed = true;
  synth?.stop();
  approach.classList.remove('static-sequence');
  approach.hidden = false; ending.hidden = true;
  setPhase('attacking');
  document.documentElement.dataset.controlled = 'true';
  $('#stop').hidden = false;
  status.textContent = '人影がこちらへ近づいてきます。Escapeキーで演出を停止できます。';
  displayFrame(0, performance.now());
  raf = requestAnimationFrame(advance);
  return true;
}
function visibleFraction(element) {
  const rect = element.getBoundingClientRect();
  const visible = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 70));
  return visible / Math.max(1, Math.min(rect.height, innerHeight - 70));
}
function updateReading() {
  if (!started || document.hidden || !['reading', 'discovery', 'static'].includes(phase)) return;
  for (const panel of cuePanels) {
    if (visibleFraction(panel) > .42 && !cuesSeen.has(panel)) {
      cuesSeen.add(panel);
      synth?.play(panel.dataset.cue);
      if (motionEnabled && ['shatter', 'phone', 'knock'].includes(panel.dataset.cue)) panel.classList.add('is-struck');
    }
  }
  if (phase === 'static' || consumed || !motionEnabled) return;
  if (visibleFraction(discovery) >= .55) {
    if (!discoverySince) discoverySince = performance.now();
    if (phase !== 'discovery') { setPhase('discovery'); armedAt = performance.now(); }
    if (!artReady && !artFailed) $('#loading-fallback').hidden = false;
  } else if (phase === 'discovery') {
    setPhase('reading'); discoverySince = 0; armedAt = 0;
  }
}
function eligibleForAttack() {
  return phase === 'discovery' && performance.now() - armedAt > 350 && visibleFraction(discovery) >= .45;
}
function isControlled() { return phase === 'attacking' || phase === 'blackout'; }

window.addEventListener('scroll', updateReading, { passive: true });
window.addEventListener('wheel', event => {
  if (event.ctrlKey) return;
  if (isControlled()) { event.preventDefault(); return; }
  const now = performance.now();
  const freshGesture = now - lastWheel > 160;
  lastWheel = now;
  if (event.deltaY > 0 && freshGesture && eligibleForAttack() && attack()) event.preventDefault();
}, { passive: false });
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && isControlled()) { event.preventDefault(); stopAttack(); $('#motion-toggle').focus({ preventScroll: true }); return; }
  const scrollKeys = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'Home', 'End'];
  const interactive = event.target.closest?.('button,a,input,select,textarea,[contenteditable]');
  if (isControlled() && scrollKeys.includes(event.key) && !interactive) { event.preventDefault(); return; }
  if (!interactive && !event.repeat && !event.shiftKey && ['ArrowDown', 'PageDown', ' '].includes(event.key) && eligibleForAttack() && attack()) event.preventDefault();
});
window.addEventListener('touchstart', event => {
  touchStartY = event.touches[0]?.clientY ?? 0;
  touchEligible = eligibleForAttack(); touchUsed = false;
}, { passive: true });
window.addEventListener('touchmove', event => {
  if (isControlled()) { event.preventDefault(); return; }
  const distance = touchStartY - (event.touches[0]?.clientY ?? touchStartY);
  if (touchEligible && !touchUsed && distance > 9) {
    touchUsed = true;
    if (attack()) event.preventDefault();
  }
}, { passive: false });

$('#start').addEventListener('click', () => begin());
$('#quiet-start').addEventListener('click', () => begin(true));
$('.scroll-invitation').addEventListener('click', event => { event.preventDefault(); begin(); });
$('#replay').addEventListener('click', () => {
  document.querySelectorAll('.is-struck').forEach(el => el.classList.remove('is-struck'));
  begin();
});
$('#stop').addEventListener('click', () => stopAttack());
$('#continue-static').addEventListener('click', () => { motionEnabled = false; syncControls(); showStatic(); $('#loading-fallback').hidden = true; });
$('#sound-toggle').addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  synth?.setEnabled(soundEnabled);
  syncControls();
  if (soundEnabled) void unlockSound();
});
$('#motion-toggle').addEventListener('click', () => {
  if (isControlled()) { stopAttack(); return; }
  motionEnabled = !motionEnabled && !artFailed;
  syncControls();
  if (started && !motionEnabled) { synth?.stop(); showStatic(); }
  else if (started && !consumed && phase === 'static') {
    approach.hidden = true; ending.hidden = true;
    setPhase('reading'); armedAt = performance.now(); updateReading();
  }
});
$('#frames-toggle').addEventListener('click', () => {
  gallery.hidden = !gallery.hidden;
  $('#frames-toggle').setAttribute('aria-expanded', String(!gallery.hidden));
  if (!gallery.hidden) scrollToElement(gallery);
});
motionQuery.addEventListener('change', event => {
  if (event.matches) {
    motionEnabled = false; syncControls();
    if (isControlled()) stopAttack('端末の動きを減らす設定に合わせ、自動演出を停止しました。');
    else if (started) showStatic();
  }
});
window.addEventListener('resize', () => {
  // Mobile browser chrome changes height while scrolling; only actual width/orientation changes cancel.
  if (Math.abs(innerWidth - lastWidth) > 50 && isControlled()) stopAttack();
  lastWidth = innerWidth;
  if (!isControlled()) { discoverySince = 0; armedAt = performance.now(); updateReading(); }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (isControlled()) stopAttack('画面を離れたため、自動演出を停止しました。');
    synth?.stop();
    void audioContext?.suspend().catch(() => {});
  } else {
    armedAt = performance.now();
    // Audio resumes only after the next explicit user gesture.
  }
});
window.addEventListener('pointerdown', () => {
  if (started && soundEnabled && audioContext?.state === 'suspended') void unlockSound();
}, { passive: true });
window.addEventListener('pagehide', () => { cancelAnimation(); if (started) { consumed = true; motionEnabled = false; syncControls(); showStatic(); } void audioContext?.suspend().catch(() => {}); });
syncControls();
