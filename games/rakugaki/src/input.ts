import { emptyInput, type InputState } from "./sim";
import { clamp } from "./util";

const GAME_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Space",
  "KeyA",
  "KeyD",
  "KeyW",
  "KeyS",
  "KeyJ",
  "KeyK",
  "KeyL",
  "KeyR",
  "ShiftLeft",
  "ShiftRight",
]);

type TouchButton = "jump" | "kickflip" | "heelflip" | "shove" | "crouch" | "reset";

/** Keyboard plus on-screen touch controls. `poll()` returns edge-aware state once per frame. */
export class Input {
  private readonly held = new Set<string>();
  private readonly tapped = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly touchHeld = new Set<TouchButton>();
  private readonly touchPressed = new Set<TouchButton>();
  private joySteer = 0;
  private joyPush = false;
  private joyBrake = false;
  private joyPointer: number | null = null;
  private joyCenter = { x: 0, y: 0 };
  /** Menu-level key presses (Enter, Escape...) that the game loop handles itself. */
  onMenuKey: ((code: string) => void) | null = null;
  enabled = true;

  constructor(private readonly touchRoot: HTMLElement) {}

  attach(): void {
    window.addEventListener("keydown", (e) => {
      if (e.code === "Enter" || e.code === "Escape" || e.code === "KeyP" || e.code === "KeyM") {
        this.onMenuKey?.(e.code);
      }
      if (!GAME_KEYS.has(e.code)) return;
      if (this.enabled && !(e.target instanceof HTMLInputElement)) e.preventDefault();
      if (e.repeat) return;
      this.held.add(e.code);
      this.tapped.add(e.code);
      this.pressed.add(e.code);
    });
    window.addEventListener("keyup", (e) => {
      this.held.delete(e.code);
    });
    window.addEventListener("blur", () => {
      this.held.clear();
      this.touchHeld.clear();
      this.joySteer = 0;
      this.joyPush = false;
      this.joyBrake = false;
    });

    const buttons = this.touchRoot.querySelectorAll<HTMLElement>("[data-btn]");
    buttons.forEach((el) => {
      const name = el.dataset.btn as TouchButton;
      const down = (e: PointerEvent) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        el.classList.add("is-down");
        this.touchHeld.add(name);
        this.touchPressed.add(name);
      };
      const up = () => {
        el.classList.remove("is-down");
        this.touchHeld.delete(name);
      };
      el.addEventListener("pointerdown", down);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      el.addEventListener("lostpointercapture", up);
      el.addEventListener("contextmenu", (e) => e.preventDefault());
    });

    const joy = this.touchRoot.querySelector<HTMLElement>("[data-joy]");
    const knob = this.touchRoot.querySelector<HTMLElement>("[data-knob]");
    if (joy && knob) {
      const reset = () => {
        this.joyPointer = null;
        this.joySteer = 0;
        this.joyPush = false;
        this.joyBrake = false;
        knob.style.transform = "translate(0px, 0px)";
      };
      joy.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        joy.setPointerCapture(e.pointerId);
        this.joyPointer = e.pointerId;
        this.joyCenter = { x: e.clientX, y: e.clientY };
      });
      joy.addEventListener("pointermove", (e) => {
        if (e.pointerId !== this.joyPointer) return;
        const dx = clamp(e.clientX - this.joyCenter.x, -48, 48);
        const dy = clamp(e.clientY - this.joyCenter.y, -48, 48);
        this.joySteer = Math.abs(dx) < 8 ? 0 : clamp(dx / 40, -1, 1);
        this.joyPush = dy < -22;
        this.joyBrake = dy > 22;
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
      });
      joy.addEventListener("pointerup", reset);
      joy.addEventListener("pointercancel", reset);
      joy.addEventListener("lostpointercapture", reset);
      joy.addEventListener("contextmenu", (e) => e.preventDefault());
    }
  }

  poll(): InputState {
    const s = emptyInput();
    if (this.enabled) {
      const left = this.held.has("ArrowLeft") || this.held.has("KeyA");
      const right = this.held.has("ArrowRight") || this.held.has("KeyD");
      s.steer = (right ? 1 : 0) - (left ? 1 : 0);
      if (s.steer === 0) s.steer = this.joySteer;
      s.push =
        this.held.has("ArrowUp") ||
        this.held.has("KeyW") ||
        this.tapped.has("ArrowUp") ||
        this.tapped.has("KeyW") ||
        this.joyPush;
      s.brake = this.held.has("ArrowDown") || this.held.has("KeyS") || this.joyBrake;
      s.crouch =
        this.held.has("ShiftLeft") ||
        this.held.has("ShiftRight") ||
        this.touchHeld.has("crouch");
      s.jump =
        this.held.has("Space") ||
        this.tapped.has("Space") ||
        this.touchHeld.has("jump") ||
        this.touchPressed.has("jump");
      s.kickflip = this.pressed.has("KeyJ") || this.touchPressed.has("kickflip");
      s.heelflip = this.pressed.has("KeyK") || this.touchPressed.has("heelflip");
      s.shove = this.pressed.has("KeyL") || this.touchPressed.has("shove");
      s.reset = this.pressed.has("KeyR") || this.touchPressed.has("reset");
    }
    this.pressed.clear();
    this.tapped.clear();
    this.touchPressed.clear();
    return s;
  }

  /** Drop any latched presses (used when leaving menus). */
  flush(): void {
    this.pressed.clear();
    this.tapped.clear();
    this.touchPressed.clear();
  }
}
