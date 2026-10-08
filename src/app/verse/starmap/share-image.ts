/**
 * The gallery share pattern for a rendered image: the native share sheet with
 * the PNG attached where the browser can share files, otherwise the link goes
 * to the clipboard. Returns the channel used, or null when the user dismissed
 * the sheet or neither path is available.
 */
export async function shareImage(
  blob: Blob,
  filename: string,
  title: string,
  url: string,
): Promise<'native' | 'copy' | null> {
  try {
    const file = new File([blob], filename, { type: 'image/png' });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title, url });
      return 'native';
    }
    if (navigator.share) {
      await navigator.share({ title, url });
      return 'native';
    }
    await navigator.clipboard.writeText(url);
    return 'copy';
  } catch {
    return null;
  }
}
