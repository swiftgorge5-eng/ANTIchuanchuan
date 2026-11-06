import { useRef } from "react";
import { PHOTO_LIMIT } from "./copy.ts";
import { MAX_FILES, type LocalPhoto } from "./photos.ts";

interface PhotoStageProps {
  photos: readonly LocalPhoto[];
  activeId: string;
  dragging: boolean;
  onDragging: (value: boolean) => void;
  onAdd: (files: FileList) => void;
  onSelect: (localId: string) => void;
  onRemove: (localId: string) => void;
  onPreview: () => void;
  locked: boolean;
}

export function PhotoStage({ photos, activeId, dragging, onDragging, onAdd, onSelect, onRemove, onPreview, locked }: PhotoStageProps) {
  const active = photos.find((photo) => photo.localId === activeId) ?? photos[0];
  const inputRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  function leaveDrag() {
    depth.current = 0;
    onDragging(false);
  }

  return (
    <section className="photo-stage" aria-label="房屋照片">
      <div
        className={dragging ? "mat is-drag" : "mat"}
        onDragEnter={(event) => {
          event.preventDefault();
          if (locked) {
            leaveDrag();
            return;
          }
          depth.current += 1;
          onDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!locked) onDragging(true);
        }}
        onDragLeave={() => {
          if (locked) {
            leaveDrag();
            return;
          }
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) onDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          leaveDrag();
          if (locked || event.dataTransfer.files.length === 0) return;
          onAdd(event.dataTransfer.files);
        }}
      >
        {active ? (
          <button type="button" className="mat-photo" onClick={onPreview}>
            <img src={active.url} alt="当前选中的房屋照片" />
          </button>
        ) : (
          <div className="mat-empty">
            <p className="mat-title">把房屋照片放在这里</p>
            <p>点击选择，或把文件拖进来。{PHOTO_LIMIT}</p>
          </div>
        )}
      </div>
      <div className="photo-tools">
        <button type="button" className="btn" disabled={locked} onClick={() => inputRef.current?.click()}>
          {photos.length > 0 ? "继续添加" : "选择照片"}
        </button>
        <input
          ref={inputRef}
          className="file-input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={(event) => {
            if (event.target.files && event.target.files.length > 0) onAdd(event.target.files);
            event.target.value = "";
          }}
        />
        <button type="button" className="btn secondary" onClick={onPreview} disabled={!active}>
          放大
        </button>
        <button type="button" className="btn secondary" onClick={() => active && onRemove(active.localId)} disabled={!active || locked}>
          删除这张
        </button>
        <p className="tool-count">{photos.length}/{MAX_FILES}</p>
      </div>
      {photos.length > 0 && (
        <ul className="thumbs">
          {photos.map((photo, index) => (
            <li key={photo.localId}>
              <button
                type="button"
                className={photo.localId === active?.localId ? "thumb is-on" : "thumb"}
                onClick={() => onSelect(photo.localId)}
                aria-label={`查看第 ${index + 1} 张照片`}
              >
                <img src={photo.url} alt="" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {photos.length > 1 && (
        <p className="note">
          多张照片时，报告会留下这次提交的文件名，但观察分组仍对不上某一张缩略图。需要逐张对照时，请一次放一张。
        </p>
      )}
    </section>
  );
}
