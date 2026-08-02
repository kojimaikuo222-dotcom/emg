// Exporting a file from inside the Android app shell. A plain <a download> click (the web
// approach) is a no-op in a bare Capacitor WebView — there's no download manager listening
// for it. Write the CSV into the app's cache dir instead and hand it to Android's native
// share sheet, which lets the user save it into Files/Drive/whatever they pick.
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export async function exportCSVNative(filename, csvText) {
  const { uri } = await Filesystem.writeFile({
    path: filename,
    data: csvText,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  await Share.share({
    title: filename,
    dialogTitle: '保存 / 分享 CSV',
    files: [uri],
  });
}
