import { createSpinner, FRAME_HEIGHT } from "./spinner.js";
import { enterFullScreen, exitFullScreen, writeCentered, termSize, drawTopBar } from "./screen.js";
import { boldOrange, dim } from "./styles.js";

export function runLogoSpinner(): { stop: () => void } {
  const { rows } = termSize();
  enterFullScreen(); drawTopBar();
  const logoTop = Math.floor((rows - FRAME_HEIGHT - 4) / 2);
  writeCentered(logoTop + FRAME_HEIGHT + 1, boldOrange("claudemesh"));
  writeCentered(logoTop + FRAME_HEIGHT + 2, dim("peer mesh for Claude Code"));
  const spinner = createSpinner({
    render(lines) { for (let i = 0; i < lines.length; i++) writeCentered(logoTop + i, lines[i]!); },
    interval: 70,
  });
  spinner.start();
  return { stop() { spinner.stop(); exitFullScreen(); } };
}
