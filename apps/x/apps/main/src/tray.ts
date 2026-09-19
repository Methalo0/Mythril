import { app, Menu, Tray, nativeImage } from "electron";
import {
  getQuickAskShortcutState,
  onQuickAskShortcutChanged,
  toggleQuickAsk,
} from "./quick-ask.js";

/**
 * Menu bar / system tray presence (Granola-style resident app).
 *
 * The icon is the app glyph pre-rendered as a macOS "template" image
 * (pure black + alpha, derived from icons/icon.png: alpha = pixel
 * luminance, so the white sail becomes an opaque black shape and the
 * black rounded square becomes transparent). Embedded as base64 so the
 * tray never depends on asset paths that differ between dev and
 * packaged layouts. Template rendering makes macOS tint it correctly
 * in light/dark menu bars and while highlighted.
 */
const TRAY_ICON_18 =
  "iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAABa0lEQVR42qXUPUjDQBQH8Mza2CbN3SVtGqwgLiIIUlSKWNGCEhALRQU/KBRBRSiIDqVUB910cxHd3BQXR7fi6tq1a1dXp5N7mkcvH1rw4Me9+8h/ehdF8Y2kwXg/lKjRb8CvgWEXDMI4YZS3P8+QWIv9yDD/ATEpb3000WO3LK3FeSDIH/LcbaC7zqak90yQwrzitlOXXLW3I/nvSkGF8xxYulgBjffKn45bU0AKytdnkMoISNgMHL1Vsfbsv84iKSh3kkeqSX4wMKDpPOFY3zIU7L7MIylosjaHhlIMDCYNrDXHhLWYhfJTEUlB44cFFE9bIEYo1tpwiquEwiy4Dy6Sgsb2FlE8kw7Qs7Zk4b6EpCDRsdlKESQcG3l70zcbXB9xkFgLXqcr/o62t5ZDTVzvBPR2eKC7qUW55VDO1l3J6GUViXNxr6+3ZtqU66VVlG4eALEf+taiwrzXH3PXgHZaC339//4v+b/7AkEc62Mua/DgAAAAAElFTkSuQmCC";
const TRAY_ICON_36 =
  "iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAADWklEQVR42tXYT0gUURwHcO/uun/nzZ+d/aMVUYQQiamoqKVlbZiSmJmKaJaFYpQRm3/6Y0SQRNShqEPgISgi6FDgoZAu/TvUQaIOHurgoUuHCDq9+D13njPzm52Z/UPUwgd233vz5uvMm+d7U1Tk8AmFRVpIRbl8Ch0i53B/K4irYLl0FBbSiE66LO9QWYUgIhVEQolE6NLvGQTKoV4LmHUgt0EEUWQnExVC3/2cMfjw6woqg3ar4dwFcx2IXZF0kMUf08jDlU7Oqh6Og+Ohn7wDQSdEJlSMEPr8+5TB/LcuS+Z2AI6HfuxCuQ7zeGXS4O5ytyvm44BjKLsw81/PITe/9GTNqp9MoSwD3VlOIdeWevNm1a+rQBffnGQuvZ2gsx/7C+765xSd+zTOOAaCx7PxfCXXPLuHmXw/UDCnFis483RQZDV26qeqEA8JM36VGJx+PYiY22jGXmxHzGMJBYIZtjZVjXjEEPWKAuNXRW701RCir18TpiMLNQicL2MguHwws1afrUG8YniNRBh/VGKOvBzmtDJOFbihZ3UInE9/23AgmdDKiVrEKwkmIuOPyUzvwjH+nYsSg/6nDQiblzIGSk+EFafqkBKZWPLKElMcDFF/TGECMdHSoSc7EPNEaRlo63g9UqKIBsWhMCoLxCQO6vW/QeejFsRVoPKxBqREkQw8YQGVBeIyB/X636D9QStiHyg9hracaER8EdlRIKHYSs4nEfsxlH7KNo00IT5VQczlgUSE2XW/jX/Xg3Iz26dMm4c2Du9EfNEIYq4Llqq06V4HA9/NtDo923lIG0ewoFo/2Gzgj0YQc5u6251csCyK6OsBnMdxptZum6QSWjrQwvljKqKvB1W3DnLBshiir4f+zbcr4397WANDejlKaLxvNxOIRxGtTrPtRg8XXBdHtDroly1rRZfrIbagl1aXrXKMUPVwqyvlc32OoD/oV7C4Oo4rRngkpXQouXuvo81XB2xBP5LD2tp2XW0OpSQEKnYlM9pwecgSHOc6TDa7Drj3Slyg4QP7LCUuHEWgPRszbncd2e7L4OmAEwQ72pDI9HEDaAfts96XuQpl2rnCX+xr229AUqMc1Gezcy3Y3t6TbOcCZ8aZvPf2ub4BKdTbj//nhdW/8ErvD7MyoBgc9FNOAAAAAElFTkSuQmCC";

interface TrayActions {
  openApp: () => void;
  toggleMeetingNotes: () => void;
}

let tray: Tray | null = null;
let actions: TrayActions | null = null;
let recording = false;

// Tray commands issued while the renderer wasn't ready to receive them
// (window closed or still loading). Drained by the renderer on mount via
// app:consumePendingTrayCommand — same pull pattern as pending deep links.
let pendingToggleMeetingNotes = false;

export function markPendingToggleMeetingNotes(): void {
  pendingToggleMeetingNotes = true;
}

export function consumePendingToggleMeetingNotes(): boolean {
  const value = pendingToggleMeetingNotes;
  pendingToggleMeetingNotes = false;
  return value;
}

function buildTrayIcon() {
  const icon = nativeImage.createEmpty();
  icon.addRepresentation({
    scaleFactor: 1,
    buffer: Buffer.from(TRAY_ICON_18, "base64"),
  });
  icon.addRepresentation({
    scaleFactor: 2,
    buffer: Buffer.from(TRAY_ICON_36, "base64"),
  });
  icon.setTemplateImage(true);
  return icon;
}

export function createAppTray(trayActions: TrayActions): void {
  if (tray) return;
  actions = trayActions;

  try {
    tray = new Tray(buildTrayIcon());
  } catch (error) {
    // Tray support can be missing (some Linux environments). The app just
    // behaves as before: no resident presence.
    console.error("[Tray] Failed to create tray:", error);
    return;
  }

  rebuildMenu();
  // The menu shows the quick-ask chord — follow rebinds live.
  onQuickAskShortcutChanged(() => rebuildMenu());

  // macOS opens the context menu on any click. On Windows/Linux a plain
  // left-click should open the app; the menu stays on right-click.
  if (process.platform !== "darwin") {
    tray.on("click", () => actions?.openApp());
  }
}

export function hasTray(): boolean {
  return tray !== null;
}

export function isRecordingActive(): boolean {
  return recording;
}

export function setTrayRecordingState(isRecording: boolean): void {
  if (recording === isRecording) return;
  recording = isRecording;
  rebuildMenu();
  if (isRecording) startWaveAnimation();
  else stopWaveAnimation();
}

// --- Recording indicator: animated mini-waveform beside the tray icon ---
// macOS renders tray titles to the right of the icon. Braille cells give
// 1-dot-wide bars (two bars per character, four height steps each) — a slim
// waveform, an unmissable "Mythril is capturing this meeting" signal.

const WAVE_FRAME_MS = 300;
const WAVE_BAR_COUNT = 5;
// Dot bits for a bar of height 1–4 (index 0–3), built bottom-up. Two bars
// per braille cell (left column: dots 7,3,2,1 — right column: dots 8,6,5,4)
// keeps the columns tightly packed; the sine wave keeps every bar ≥1 dot so
// no column ever reads as missing.
const WAVE_LEFT_BITS = [0x40, 0x44, 0x46, 0x47];
const WAVE_RIGHT_BITS = [0x80, 0xa0, 0xb0, 0xb8];
// Radians per bar / per frame: together they make the crest travel smoothly
// leftward across the five bars.
const WAVE_SPATIAL_STEP = 1.1;
const WAVE_PHASE_STEP = 0.9;

let waveTimer: NodeJS.Timeout | null = null;
let wavePhase = 0;

function waveString(phase: number): string {
  const levels: number[] = [];
  for (let i = 0; i < WAVE_BAR_COUNT; i++) {
    const level = Math.round(1.5 + 1.5 * Math.sin(phase + i * WAVE_SPATIAL_STEP));
    levels.push(Math.min(3, Math.max(0, level)));
  }
  let out = "";
  for (let i = 0; i < levels.length; i += 2) {
    const left = WAVE_LEFT_BITS[levels[i]];
    const right = levels[i + 1] !== undefined ? WAVE_RIGHT_BITS[levels[i + 1]] : 0;
    out += String.fromCharCode(0x2800 + left + right);
  }
  return out;
}

function startWaveAnimation(): void {
  if (!tray || process.platform !== "darwin") return;
  stopWaveAnimation();
  waveTimer = setInterval(() => {
    if (!tray) return;
    wavePhase += WAVE_PHASE_STEP;
    tray.setTitle(` ${waveString(wavePhase)}`, { fontType: "monospaced" });
  }, WAVE_FRAME_MS);
}

function stopWaveAnimation(): void {
  if (waveTimer) {
    clearInterval(waveTimer);
    waveTimer = null;
  }
  if (tray && process.platform === "darwin") tray.setTitle("");
}

function rebuildMenu(): void {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: "Open Mythril", click: () => actions?.openApp() },
    // Permanent discoverability for the global quick-ask shortcut — the
    // accelerator renders next to the label (display only; the real binding
    // is the globalShortcut in quick-ask.ts). Hidden while the chord is
    // unregistered (another app owns it) — showing a dead chord would lie.
    {
      label: "Quick Ask",
      ...(getQuickAskShortcutState().registered
        ? { accelerator: getQuickAskShortcutState().accelerator }
        : {}),
      registerAccelerator: false,
      // The same summon the chord performs.
      click: () => toggleQuickAsk(),
    },
    recording
      ? {
          label: "Stop recording and generate notes",
          click: () => actions?.toggleMeetingNotes(),
        }
      : {
          label: "Start meeting notes",
          click: () => actions?.toggleMeetingNotes(),
        },
    { type: "separator" },
    { label: "Quit Mythril", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(recording ? "Mythril" : "Mythril");
}
