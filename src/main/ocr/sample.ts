/**
 * The picture the self-test feeds to the OCR engine.
 *
 * Kept in its own module so the test suite can check the same picture: if the
 * sample ever stops being readable, the self-test would report an OCR failure
 * that has nothing to do with the engine.
 */
export const OCR_SAMPLE_TEXT = 'Flushot self test'

export function ocrSampleSvg(text = OCR_SAMPLE_TEXT): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // Large type on purpose: this verifies the pipeline, not the engine's ability
  // to read 8 px letters, which no OCR does well.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="220">
    <rect width="900" height="220" fill="#ffffff"/>
    <text x="40" y="140" font-family="Segoe UI, Arial" font-size="72" fill="#111111">${escaped}</text>
  </svg>`
}
