import { useEffect, useRef, useState } from "react";
import type { AnalysisInput, AnalysisStage, FinalReport } from "../core/index.ts";
import { downloadFailure, errorCode, runPageAnalysis, safeMessage, saveReport, type EvidenceSource } from "./analyze.ts";
import { buildAnalysisInput, RENTAL_LABEL } from "./copy.ts";
import { PhotoStage } from "./PhotoStage.tsx";
import { releasePhoto, releaseSubmitted, rememberPhotos, takePhotos, type LocalPhoto, type SubmittedPhoto } from "./photos.ts";
import { ReportView } from "./ReportView.tsx";
import { StageRail } from "./StageRail.tsx";

type Phase = "idle" | "running" | "success" | "error" | "cancelled";
type RentalMode = NonNullable<AnalysisInput["rentalMode"]>;

function sourceNote(source: EvidenceSource): string {
  if (source === "history") {
    return "当前为 Mock。历史出处来自本地收录；照片观察固定为无法判断，不是模型识别。分数为空时表示证据不足。";
  }
  return "当前为 Mock。照片观察和资料都是演示数据，不是模型识别，也不会给出数字分数。";
}

export function App() {
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [activeId, setActiveId] = useState("");
  const [dragging, setDragging] = useState(false);
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");
  const [communityName, setCommunityName] = useState("");
  const [addressHint, setAddressHint] = useState("");
  const [rentalMode, setRentalMode] = useState<RentalMode>("unknown");
  const [source, setSource] = useState<EvidenceSource>("demo");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [stages, setStages] = useState<AnalysisStage[]>([]);
  const [report, setReport] = useState<FinalReport | null>(null);
  const [error, setError] = useState("");
  const [previewId, setPreviewId] = useState("");
  const [batch, setBatch] = useState<SubmittedPhoto[]>([]);
  const controllerRef = useRef<AbortController | null>(null);
  const tokenRef = useRef(0);
  const mountedRef = useRef(true);
  const photosRef = useRef(photos);
  const previewRef = useRef<HTMLDialogElement>(null);
  const downloadRef = useRef<HTMLDialogElement>(null);
  const batchRef = useRef<SubmittedPhoto[]>([]);
  photosRef.current = photos;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      for (const photo of photosRef.current) releasePhoto(photo);
      releaseSubmitted(batchRef.current);
    };
  }, []);

  function addPhotos(files: FileList) {
    const result = takePhotos(photos, files);
    setPhotos(result.photos);
    setError(result.message);
    setActiveId((current) => result.photos.some((photo) => photo.localId === current)
      ? current
      : result.photos[result.photos.length - 1]?.localId ?? "");
  }

  function removePhoto(localId: string) {
    const target = photos.find((photo) => photo.localId === localId);
    if (target) releasePhoto(target);
    const next = photos.filter((photo) => photo.localId !== localId);
    setPhotos(next);
    setActiveId((current) => current === localId ? next[0]?.localId ?? "" : current);
    if (previewId === localId) {
      setPreviewId("");
      previewRef.current?.close();
    }
  }

  function openPreview() {
    const active = photos.find((photo) => photo.localId === activeId) ?? photos[0];
    if (!active) return;
    setPreviewId(active.localId);
    previewRef.current?.showModal();
  }

  async function start(mode: AnalysisInput["mode"]) {
    if (photos.length === 0) {
      setError("请选择至少一张照片");
      return;
    }
    if (mode === "real" && !apiKey.trim()) {
      setError("真实模式需要本次使用的模型密钥。照片没有被读取。");
      return;
    }
    const submitted = photos.map((photo) => photo.file);
    const built = buildAnalysisInput({
      photos: photos.map((photo) => photo.file),
      apiKey,
      mode,
      rentalMode,
      city,
      district,
      communityName,
      addressHint,
    });
    if (!built.input) {
      setError(built.error ?? "分析输入不符合接口或安全要求");
      return;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const token = ++tokenRef.current;
    setPhase("running");
    setError("");
    setReport(null);
    setStages([]);
    releaseSubmitted(batchRef.current);
    batchRef.current = [];
    setBatch([]);
    try {
      const next = await runPageAnalysis(source, built.input, (stage) => {
        if (!mountedRef.current || tokenRef.current !== token) return;
        setStages((current) => current[current.length - 1] === stage ? current : [...current, stage]);
      }, controller.signal);
      if (!mountedRef.current || tokenRef.current !== token) return;
      const nextBatch = rememberPhotos(submitted);
      releaseSubmitted(batchRef.current);
      batchRef.current = nextBatch;
      setBatch(nextBatch);
      setReport(next);
      setPhase("success");
    } catch (caught) {
      if (!mountedRef.current || tokenRef.current !== token) return;
      setError(safeMessage(caught, mode));
      setPhase(errorCode(caught) === "CANCELLED" ? "cancelled" : "error");
    }
  }

  function confirmDownload() {
    downloadRef.current?.close();
    if (!report) return;
    try {
      saveReport(report);
    } catch (caught) {
      setError(downloadFailure(caught));
    }
  }

  const preview = photos.find((photo) => photo.localId === previewId);
  const running = phase === "running";

  return (
    <>
      <header className="top">
        <div>
          <p className="brand">antochuanchuan</p>
          <h1>房屋照片风险辅助识别</h1>
        </div>
        <p className="lede">
          这里展示的是未校准的规则符合度，不是串串房概率。照片不能证明甲醛、承重墙、产权或合同。没有匹配到公开资料，也不等于没有风险。
        </p>
      </header>

      <main className="workspace">
        <PhotoStage
          photos={photos}
          activeId={activeId}
          dragging={dragging}
          onDragging={setDragging}
          onAdd={addPhotos}
          onSelect={setActiveId}
          onRemove={removePhoto}
          onPreview={openPreview}
          locked={running}
        />

        <aside className="panel">
          <form className="controls no-print" onSubmit={(event) => {
            event.preventDefault();
            if (apiKey.trim()) {
              setError("Mock 分析不会使用密钥。请先清除密钥，或改点「尝试真实分析」。");
              return;
            }
            void start("mock");
          }}>
            <div className="section-head">
              <h2>这次要看的房子</h2>
              <p>地点可以不填。填写后只用于检索本地资料。</p>
            </div>
            <div className="fields">
              <label>城市<input value={city} disabled={running} onChange={(event) => setCity(event.target.value)} placeholder="上海" /></label>
              <label>区<input value={district} disabled={running} onChange={(event) => setDistrict(event.target.value)} placeholder="普陀区" /></label>
              <label className="wide">小区<input value={communityName} disabled={running} onChange={(event) => setCommunityName(event.target.value)} placeholder="金纺苑" /></label>
              <label className="wide">地址线索<input value={addressHint} disabled={running} onChange={(event) => setAddressHint(event.target.value)} placeholder="选填，不精确到门牌" /></label>
            </div>
            {source === "history" && (
              <button
                type="button"
                className="text-btn"
                disabled={running}
                onClick={() => {
                  setCity("上海");
                  setDistrict("普陀区");
                  setCommunityName("金纺苑");
                  setAddressHint("");
                }}
              >
                填入示例：上海 / 普陀区 / 金纺苑
              </button>
            )}
            <label className="line">
              租住方式
              <select value={rentalMode} disabled={running} onChange={(event) => setRentalMode(event.target.value as RentalMode)}>
                {(Object.keys(RENTAL_LABEL) as RentalMode[]).map((key) => <option key={key} value={key}>{RENTAL_LABEL[key]}</option>)}
              </select>
            </label>
            <fieldset disabled={running}>
              <legend>资料来源</legend>
              <label><input type="radio" name="source" checked={source === "demo"} onChange={() => setSource("demo")} />离线演示</label>
              <label><input type="radio" name="source" checked={source === "history"} onChange={() => setSource("history")} />本地历史资料</label>
            </fieldset>
            <p className="note">
              {source === "history"
                ? "只检索仓库里已收录的历史记录。没有命中，表示这批资料里没有，不是房屋没有问题。"
                : "离线演示不读取真实出处，证据卡会标明演示数据。"}
            </p>

            <div className="key-box">
              <label>
                模型密钥
                <input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  disabled={running}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </label>
              <div className="key-actions">
                <button type="button" className="text-btn" onClick={() => setShowKey((value) => !value)}>{showKey ? "隐藏" : "显示"}</button>
                <button type="button" className="text-btn" onClick={() => setApiKey("")}>清除</button>
              </div>
              <p className="note">密钥只留在这次页面的内存里。刷新就消失，不会写入浏览器存储、网址或报告。</p>
            </div>

            <div className="actions">
              <button type="submit" className="btn" disabled={running}>开始 Mock 分析</button>
              <button type="button" className="btn secondary" disabled={running} onClick={() => void start("real")}>尝试真实分析</button>
              <button type="button" className="btn secondary" disabled={!running} onClick={() => controllerRef.current?.abort()}>取消</button>
            </div>
            <p className="note">真实视觉模型尚未接入。点击真实分析会走接口，但会在读取照片之前停止，照片不会发往第三方。</p>
          </form>

          <StageRail stages={stages} phase={phase} sourceNote={sourceNote(source)} />
          {error && <p className="banner" role="alert">{error}</p>}
          {phase === "cancelled" && !error && <p className="banner">分析已取消。</p>}
          {report && <ReportView report={report} batch={batch} />}
          {report && (
            <div className="export no-print">
              <button type="button" className="btn" onClick={() => downloadRef.current?.showModal()}>下载 JSON</button>
              <button type="button" className="btn secondary" onClick={() => window.print()}>打印</button>
            </div>
          )}
        </aside>
      </main>

      <dialog ref={previewRef} className="preview" onClose={() => setPreviewId("")}>
        {preview && <img src={preview.url} alt="房屋照片放大预览" />}
        <form method="dialog"><button className="btn secondary">关闭</button></form>
      </dialog>

      <dialog ref={downloadRef} className="sheet">
        <h2>下载前请知道</h2>
        <p>这份 JSON 会带上你填写的城市、小区和地址线索，以及资料摘要。它不是匿名文件，只会保存到你的电脑，不会上传。</p>
        <form method="dialog" className="actions">
          <button type="button" className="btn" onClick={confirmDownload}>确认下载</button>
          <button className="btn secondary">取消</button>
        </form>
      </dialog>
    </>
  );
}
