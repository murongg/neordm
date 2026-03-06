const DEFAULT_MIN_HUE_DISTANCE = 42;
const DEFAULT_ATTEMPTS = 8;

const lastGeneratedHueByScope = new Map<string, number>();

interface RandomStableColorOptions {
  scope?: string;
  minHueDistance?: number;
  attempts?: number;
  saturationRange?: [number, number];
  lightnessRange?: [number, number];
}

function toHex(value: number) {
  return Math.round(value).toString(16).padStart(2, "0");
}

function hslToHex(hue: number, saturation: number, lightness: number) {
  const normalizedHue = hue / 360;
  const normalizedSaturation = saturation / 100;
  const normalizedLightness = lightness / 100;

  const hueToRgb = (p: number, q: number, t: number) => {
    let nextT = t;

    if (nextT < 0) nextT += 1;
    if (nextT > 1) nextT -= 1;
    if (nextT < 1 / 6) return p + (q - p) * 6 * nextT;
    if (nextT < 1 / 2) return q;
    if (nextT < 2 / 3) return p + (q - p) * (2 / 3 - nextT) * 6;

    return p;
  };

  if (normalizedSaturation === 0) {
    const channel = normalizedLightness * 255;
    return `#${toHex(channel)}${toHex(channel)}${toHex(channel)}`;
  }

  const q =
    normalizedLightness < 0.5
      ? normalizedLightness * (1 + normalizedSaturation)
      : normalizedLightness +
        normalizedSaturation -
        normalizedLightness * normalizedSaturation;
  const p = 2 * normalizedLightness - q;

  const red = hueToRgb(p, q, normalizedHue + 1 / 3) * 255;
  const green = hueToRgb(p, q, normalizedHue) * 255;
  const blue = hueToRgb(p, q, normalizedHue - 1 / 3) * 255;

  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

function getHueDistance(nextHue: number, previousHue: number) {
  const distance = Math.abs(nextHue - previousHue);
  return Math.min(distance, 360 - distance);
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

export function getRandomStableColor({
  scope = "default",
  minHueDistance = DEFAULT_MIN_HUE_DISTANCE,
  attempts = DEFAULT_ATTEMPTS,
  saturationRange = [68, 80],
  lightnessRange = [50, 58],
}: RandomStableColorOptions = {}) {
  const lastGeneratedHue = lastGeneratedHueByScope.get(scope) ?? null;
  let hue = Math.floor(Math.random() * 360);
  let bestHue = hue;
  let bestDistance =
    lastGeneratedHue === null ? 360 : getHueDistance(hue, lastGeneratedHue);

  if (lastGeneratedHue !== null) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const candidateHue = Math.floor(Math.random() * 360);
      const candidateDistance = getHueDistance(candidateHue, lastGeneratedHue);

      if (candidateDistance >= minHueDistance) {
        hue = candidateHue;
        bestDistance = candidateDistance;
        break;
      }

      if (candidateDistance > bestDistance) {
        bestHue = candidateHue;
        bestDistance = candidateDistance;
      }
    }

    if (bestDistance < minHueDistance) {
      hue = bestHue;
    }
  }

  const saturation = randomBetween(...saturationRange);
  const lightness = randomBetween(...lightnessRange);

  lastGeneratedHueByScope.set(scope, hue);

  return hslToHex(hue, saturation, lightness);
}
