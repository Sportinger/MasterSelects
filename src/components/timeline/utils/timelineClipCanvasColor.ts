export function withTimelineClipCanvasAlpha(color: string, alpha: number): string {
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
    let red: number;
    let green: number;
    let blue: number;
    if (color.length === 4) {
      red = parseInt(color[1] + color[1], 16);
      green = parseInt(color[2] + color[2], 16);
      blue = parseInt(color[3] + color[3], 16);
    } else {
      red = parseInt(color.slice(1, 3), 16);
      green = parseInt(color.slice(3, 5), 16);
      blue = parseInt(color.slice(5, 7), 16);
    }
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }
  return color;
}
