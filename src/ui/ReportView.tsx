import type { FinalReport } from "../core/index.ts";
import { CATEGORY_LABEL, evidenceIntro, LEVEL_LABEL, RENTAL_LABEL, STATE_LABEL } from "./copy.ts";
import type { SubmittedPhoto } from "./photos.ts";

interface ReportViewProps {
  report: FinalReport;
  batch: readonly SubmittedPhoto[];
}

function RiskMark({ report }: { report: FinalReport }) {
  const { score, level } = report.risk;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const empty = score === null;
  return (
    <section className="risk" aria-label="风险规则符合度">
      <svg className="ring" viewBox="0 0 120 120" aria-hidden="true">
        <circle className={empty ? "ring-track is-dashed" : "ring-track"} cx="60" cy="60" r={radius} />
        {!empty && (
          <circle
            className={`ring-value is-${level}`}
            cx="60"
            cy="60"
            r={radius}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - score)}
          />
        )}
        {empty ? (
          <text x="60" y="64" textAnchor="middle">证据不足</text>
        ) : (
          <text x="60" y="64" textAnchor="middle">{score.toFixed(2)}</text>
        )}
      </svg>
      <div>
        <h2>{empty ? "证据不足" : "未校准规则符合度"}</h2>
        <p className="risk-level">{LEVEL_LABEL[level]}</p>
        <p>
          {empty
            ? "没有可计算的分数，因此这里不会显示成 0%。"
            : "圆环里的数字只表示规则提示强度，不是危险概率，也不是安全鉴定。"}
        </p>
        <p>校准状态：未校准。</p>
      </div>
    </section>
  );
}

export function ReportView({ report, batch }: ReportViewProps) {
  const photoCount = batch.length;
  const groups = new Map<string, FinalReport["observations"]>();
  for (const row of report.observations) {
    const list = groups.get(row.photoId);
    if (list) list.push(row);
    else groups.set(row.photoId, [row]);
  }
  const evidence = report.evidence;
  const showItems = evidence.status !== "no_match" && evidence.items.length > 0;

  return (
    <div className="report">
      <RiskMark report={report} />

      <section className="layer" aria-label="照片观察">
        <div className="section-head">
          <h2>第一层 · 照片观察</h2>
          <p>
            {photoCount === 1
              ? `来自这次提交的「${batch[0]?.name ?? "当前照片"}」。观察文本若写明合成演示，就不是模型识别。`
              : "按分析模块给出的照片编号分组，分组顺序对不上提交顺序。"}
          </p>
        </div>
        {photoCount > 0 && (
          <>
            <ul className="batch">
              {batch.map((photo) => (
                <li key={photo.url}>
                  <img src={photo.url} alt="" />
                  <span title={photo.name}>{photo.name}</span>
                </li>
              ))}
            </ul>
            <p className="note">上面是开始分析时提交的照片。之后增删左侧照片，不会改变这一份报告。</p>
          </>
        )}
        {groups.size === 0 && <p className="empty">暂无照片观察。</p>}
        {[...groups.entries()].map(([photoId, rows], groupIndex) => (
          <article key={photoId} className="card">
            <header>
              <span className="badge">观察</span>
              <span>{photoCount === 1 ? "当前照片" : `观察组 ${groupIndex + 1}`}</span>
            </header>
            <ul className="facts">
              {rows.map((row) => (
                <li key={`${row.photoId}-${row.category}`}>
                  <strong>{CATEGORY_LABEL[row.category]}</strong>
                  <span className={`state is-${row.state}`}>{STATE_LABEL[row.state]}</span>
                  {row.evidence.length > 0 && (
                    <ul>
                      {row.evidence.map((reason) => <li key={reason}>{reason}</li>)}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section className="layer" aria-label="公开资料">
        <div className="section-head">
          <h2>第二层 · 公开资料</h2>
          <p>{evidenceIntro(evidence)}</p>
        </div>
        {!showItems && <p className="empty">暂无可核验证据</p>}
        {showItems && evidence.items.map((item) => (
          <article key={item.id} className={item.sourceType === "synthetic" ? "card is-synthetic" : "card"}>
            <header>
              <span className={item.sourceType === "synthetic" ? "badge stamp" : "badge"}>
                {item.sourceType === "synthetic" ? "演示数据" : "公开记录"}
              </span>
              <span>{item.matchStatus === "confirmed" ? "已确认匹配" : "可能相关"}</span>
            </header>
            <h3>{item.title}</h3>
            <p>{item.communityName}</p>
            <p>{item.publisher}{item.sourceType === "public" ? ` · ${item.date ?? "日期未知"}` : ""}</p>
            <p>{item.summary}</p>
            {item.sourceType === "public" && item.url?.startsWith("https://") && (
              <a href={item.url} target="_blank" rel="noreferrer">查看来源</a>
            )}
          </article>
        ))}
      </section>

      <section className="layer" aria-label="最终判断与局限">
        <div className="section-head">
          <h2>第三层 · 最终判断与局限</h2>
          <p>租住方式：{RENTAL_LABEL[report.rentalMode]}。判断来自规则合成，不是房屋鉴定。</p>
        </div>
        <p>{report.risk.explanation}</p>
        <ul className="limits">
          {report.limitations.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
        </ul>
      </section>
    </div>
  );
}
