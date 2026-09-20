import type { Actions } from './sim';
export class Input {
  keys = new Set<string>(); touch = new Set<string>(); pulses = new Set<string>();
  constructor() {
    window.addEventListener('keydown', e => {
      if ((e.target as HTMLElement)?.matches('input')) return;
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);if(!e.repeat)this.pulses.add(e.code);
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.clear());
    document.querySelectorAll<HTMLElement>('[data-control]').forEach(b => {
      b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); this.touch.add(b.dataset.control!);this.pulses.add(b.dataset.control!); });
      const release = () => this.touch.delete(b.dataset.control!);
      b.addEventListener('pointerup', release); b.addEventListener('pointercancel', release); b.addEventListener('lostpointercapture', release);
    });
  }
  clear() { this.keys.clear(); this.touch.clear();this.pulses.clear(); }
  actions(index: number, split: boolean): Actions {
    const k = (s: string) => this.keys.has(s), t = (s: string) => index === 0 && this.touch.has(s);
    const pulse=(...codes:string[])=>{let value=false;for(const code of codes){if(this.pulses.has(code))value=true;this.pulses.delete(code);}return value;};
    if (split && index === 1) return { steer: Number(k('ArrowRight')) - Number(k('ArrowLeft')), brake: k('ArrowDown'), jump: pulse('Enter')||k('Enter'), trick: pulse('Slash')||k('Slash'), boost: k('ShiftRight') };
    const pad = navigator.getGamepads?.()[index];
    return { steer: (pad && Math.abs(pad.axes[0]) > .12 ? pad.axes[0] : 0) || Number(k('KeyD') || (!split && k('ArrowRight')) || t('right')) - Number(k('KeyA') || (!split && k('ArrowLeft')) || t('left')), brake: k('KeyS') || (!split && k('ArrowDown')) || t('brake') || !!pad?.buttons[1]?.pressed, jump: pulse('Space','jump') || k('Space') || t('jump') || !!pad?.buttons[0]?.pressed, trick: pulse('KeyX','KeyJ','trick') || k('KeyX') || k('KeyJ') || t('trick') || !!pad?.buttons[2]?.pressed, boost: k('ShiftLeft') || (!split && k('ShiftRight')) || t('boost') || !!pad?.buttons[7]?.pressed };
  }
}
