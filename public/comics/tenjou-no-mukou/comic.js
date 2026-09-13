import { ComicSound } from './sound.js?v=2';
import { frames, attackAssets } from './frames.js?v=6';
import { ApproachScene } from './approach.js?v=5';

const $ = (selector) => document.querySelector(selector);
const body = document.body;
const audioFiles = ComicSound.fetchFiles();
body.dataset.audio = 'loading';
let phase = 'idle';
let started = false;
let motionEnabled = true;
let synth;
let audioContext;
let artReady = false;
let artFailed = false;
let consumed = false;
let raf = 0;
let blackoutTimer = 0;
let frameIndex = -1;
let frameDeadline = 0;
let frameStartedAt = 0;
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
function syncMotion() {
  body.dataset.motion = motionEnabled ? 'on' : 'off';
}

function artElement(index) {
  const div = document.createElement('div');
  div.className = 'attack-art ' + (index === frames.length - 1 ? 'final-art' : 'atlas-cell');
  div.style.setProperty('--col', frames[index].cell % 3);
  div.style.setProperty('--row', Math.floor(frames[index].cell / 3));
  if (frames[index].sheet) div.style.backgroundImage = `url('./art/rush-${frames[index].sheet}.webp')`;
  else { div.style.backgroundSize = '130%'; div.style.backgroundPosition = '50% 35%'; }
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
  figure.append(art, caption); gallery.append(figure);
});
const steps = [...approach.children];
const scene = new ApproachScene(approach, frames);

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
const artPromise = Promise.all([...attackAssets, 'phone', 'listen'].map(name => decodeAsset(`./art/${name}.webp`)))
  .then(images => {
    // Retain decoded images for the entire reading session.
    artPromise.images = images;
    scene.setImages(new Map(images.map(image => [new URL(image.src).pathname.split('/').at(-1).replace('.webp', ''), image])));
    artReady = true;
    $('#load-status').textContent = '';
    $('#loading-fallback').hidden = true;
  }).catch(() => {
    artFailed = true;
    motionEnabled = false;
    syncMotion();
    $('#load-status').textContent = '一部の絵を読み込めませんでした。自動演出なしで読めます。';
    status.textContent = '絵の読み込みに失敗したため、自動演出を停止しました。';
    if (started) showStatic();
  });

async function unlockSound() {
  try {
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('Audio unavailable');
      audioContext = new AudioContextClass();
      audioContext.addEventListener('statechange', () => { body.dataset.audioState = audioContext.state; });
      synth = new ComicSound(audioContext);
      void synth.load(audioFiles).then(() => {
        body.dataset.audio = synth.buffers.size === 4 ? 'ready' : 'partial';
        if (synth.buffers.size !== 4) status.textContent = '一部の音を読み込めなかったため、代わりの効果音で続けます。';
      });
    }
    synth.setEnabled(true);
    if (audioContext.state === 'suspended') await audioContext.resume();
    body.dataset.audioState = audioContext.state;
  } catch {
    body.dataset.audioState = 'unavailable';
    status.textContent = 'このブラウザでは音を開始できませんでした。漫画はそのまま読めます。';
  }
}

function scrollToElement(element) {
  window.scrollTo({ top: element.getBoundingClientRect().top + scrollY, left: 0, behavior: 'instant' });
}
function begin() {
  cancelAnimation();
  $('#story').hidden = false;
  consumed = false; started = true; cuesSeen.clear();
  discoverySince = 0; armedAt = 0; frameIndex = -1;
  delete body.dataset.frame;
  lastWheel = -Infinity; touchEligible = false;
  approach.hidden = true; gallery.hidden = true; ending.hidden = true;
  $('#frames-toggle').setAttribute('aria-expanded', 'false');
  $('#loading-fallback').hidden = true;
  // Every reading starts with both effects enabled, including replay after a stop.
  motionEnabled = !artFailed;
  syncMotion();
  synth?.stop(); synth?.setEnabled(true);
  void unlockSound();
  setPhase('reading');
  if (!motionEnabled || artFailed) showStatic();
  scrollToElement($('#story'));
  $('#story').focus({ preventScroll: true });
  status.textContent = motionEnabled ? '音と動きのある漫画を読み始めました。下へスクロールして読んでください。' : '絵の読み込みに失敗したため、自動演出なしで読み始めました。';
}

function cancelAnimation() {
  cancelAnimationFrame(raf); raf = 0;
  clearTimeout(blackoutTimer); blackoutTimer = 0;
  $('#stop').hidden = true; $('#blackout').hidden = true;
  document.documentElement.removeAttribute('data-controlled');
  scene.stop();
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
  consumed = true; motionEnabled = false; syncMotion();
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
  frameStartedAt = now;
  body.dataset.frame = String(index);
  if (frames[index].cue) synth?.play(frames[index].cue);
  synth?.setApproach(index / (frames.length - 1));
  // Carry sub-refresh remainder forward but never skip a drawing after a slow frame.
  frameDeadline = index === 0 || index === frames.length - 1
    ? now + frames[index].hold
    : Math.max(frameDeadline + frames[index].hold, now);
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
  const subframe = Math.min(1, Math.max(0, (now - frameStartedAt) / frames[frameIndex].hold));
  scene.draw(frameIndex, Math.min(1, (frameIndex + subframe) / (frames.length - 1)));
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
  synth?.play('voice');
  scene.start();
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
  if (event.key === 'Escape' && isControlled()) { event.preventDefault(); stopAttack(); $('#story').focus({ preventScroll: true }); return; }
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
$('.scroll-invitation').addEventListener('click', event => { event.preventDefault(); begin(); });
$('.skip-link').addEventListener('click', event => {
  event.preventDefault();
  if (!started) begin();
  else { scrollToElement($('#story')); $('#story').focus({ preventScroll: true }); }
});
$('#replay').addEventListener('click', () => {
  document.querySelectorAll('.is-struck').forEach(el => el.classList.remove('is-struck'));
  begin();
});
$('#stop').addEventListener('click', () => stopAttack());
$('#continue-static').addEventListener('click', () => { motionEnabled = false; syncMotion(); showStatic(); $('#loading-fallback').hidden = true; });
$('#frames-toggle').addEventListener('click', () => {
  gallery.hidden = !gallery.hidden;
  $('#frames-toggle').setAttribute('aria-expanded', String(!gallery.hidden));
  if (!gallery.hidden) scrollToElement(gallery);
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
    if (started) void unlockSound();
  }
});
function resumeSound() {
  if (started && audioContext?.state === 'suspended') void unlockSound();
}
window.addEventListener('pointerdown', resumeSound, { passive: true });
window.addEventListener('keydown', resumeSound, { passive: true });
window.addEventListener('touchend', resumeSound, { passive: true });
window.addEventListener('pagehide', () => { cancelAnimation(); if (started) { consumed = true; motionEnabled = false; syncMotion(); showStatic(); } void audioContext?.suspend().catch(() => {}); });
syncMotion();
