/**
 * jsdom 沒有實作 <dialog> 的 showModal()／close()；補一個最簡單的版本，
 * 讓用到原生對話框的元件能在單元測試裡打開與關閉（Esc 則用 cancel 事件模擬）。
 */
if (
  typeof HTMLDialogElement !== 'undefined' &&
  typeof HTMLDialogElement.prototype.showModal !== 'function'
) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
}
