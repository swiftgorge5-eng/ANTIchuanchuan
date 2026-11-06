export interface LocalPhoto {
  localId: string;
  file: File;
  url: string;
}

export interface SubmittedPhoto {
  name: string;
  url: string;
}

export const MAX_FILES = 10;
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function takePhotos(current: readonly LocalPhoto[], incoming: FileList | readonly File[]): { photos: LocalPhoto[]; message: string } {
  const photos = [...current];
  const notes: string[] = [];
  const note = (text: string) => {
    if (!notes.includes(text)) notes.push(text);
  };
  for (const file of incoming) {
    if (photos.length >= MAX_FILES) {
      note("照片数量超过限制");
      break;
    }
    if (!file.size) {
      note("照片文件为空");
      continue;
    }
    if (file.size > MAX_BYTES) {
      note("照片文件超过大小限制");
      continue;
    }
    if (!TYPES.has(file.type)) {
      note("仅支持 JPEG、PNG 和 WebP 照片");
      continue;
    }
    photos.push({ localId: crypto.randomUUID(), file, url: URL.createObjectURL(file) });
  }
  return { photos, message: notes.join("；") };
}

export function rememberPhotos(files: readonly File[]): SubmittedPhoto[] {
  return files.map((file, index) => ({
    name: file.name.trim() || `照片 ${index + 1}`,
    url: URL.createObjectURL(file),
  }));
}

export function releaseSubmitted(photos: readonly SubmittedPhoto[]): void {
  for (const photo of photos) URL.revokeObjectURL(photo.url);
}

export function releasePhoto(photo: LocalPhoto): void {
  URL.revokeObjectURL(photo.url);
}
