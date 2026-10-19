/** 產生單聲道 16-bit PCM 的 WAV（一段固定音高的嗶聲），示範用配音。 */
export function makeWav(durationSec: number, sampleRate = 8000, frequency = 440): Buffer {
  const samples = Math.max(1, Math.round(durationSec * sampleRate))
  const data = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i++) {
    const envelope = Math.min(1, i / 200, (samples - i) / 200) // 頭尾淡入淡出，避免爆音
    data.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 8000 * envelope),
      i * 2,
    )
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // 單聲道
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}
