/* 把一份文本交给浏览器存成文件。整个 src/lib 里只有这一个模块碰 DOM：
   解析与格式化（ledger/storage/backup）在 Node 里也要跑得起来，单元测试才不需要浏览器。 */

/**
 * 下载靠一个临时挂上去的 <a download>：blob: 这个对象 URL 会一直占着那份内容，
 * 直到这一页关掉为止，所以用完必须收回。
 *
 * 收回与摘下 anchor 都要排到下一趟任务：click() 只是把下载交给浏览器，内容此时还没写完，
 * 同一趟任务里就 revokeObjectURL，Safari 与 Firefox 真的会取消这次下载——
 * 而调用方紧接着就说「已导出…」，界面于是撒了谎。
 */
export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 0);
}
