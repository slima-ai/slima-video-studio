/** 素材庫檔案的網址（主行程的 svs-asset 協定；格式與 main/asset-url.ts 一致）。 */
export const assetUrl = (hash: string): string => `svs-asset://asset/${hash}`
