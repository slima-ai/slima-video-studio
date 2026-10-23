/** 素材庫檔案的網址（主行程的 svs-asset 協定；格式與 main/asset-url.ts 一致）。 */
export const assetUrl = (hash: string): string => `svs-asset://asset/${hash}`

/** 匯出的成品（專案 exports/ 資料夾裡的檔案，沒有雜湊）的網址；格式與 main/asset-url.ts 的 parseExportUrl 一致。 */
export const exportUrl = (name: string): string => `svs-asset://export/${encodeURIComponent(name)}`

/** 能在 App 裡播的成品（副檔名要和 main/export-file.ts 一致）。 */
export const isPlayableExport = (name: string): boolean => /\.(mp4|m4v|mov|webm)$/i.test(name)
