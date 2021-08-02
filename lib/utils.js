/**
 * @see https://gist.github.com/lanqy/5193417
 *
 * @param {number} bytes
 * @returns {string}
 */
export function bytesToSize(bytes) {
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024));
  if (i === 0 || !Number.isFinite(i)) {
    return `${bytes} ${sizes[i] ?? sizes[0]}`;
  }
  return `${(bytes / 1024 ** i).toFixed(1)} ${sizes[i]}`;
}

/**
 * @param {string} numberText
 */
export function numSign(numberText) {
  if (numberText.startsWith("0")) {
    return `±${numberText}`;
  }
  if (numberText.startsWith("-")) {
    return numberText;
  }
  return `+${numberText}`;
}
