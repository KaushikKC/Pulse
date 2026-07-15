import { useEffect, useRef } from "react";
import { REACTION_META, REACTIONS, type VerifiedMoment } from "@pulse/shared";
import { drawMomentPoster } from "../momentImage.ts";
import { Sparkline } from "./Sparkline.tsx";

interface Props {
  moment: VerifiedMoment;
  homeColor: string;
  awayColor: string;
  bgColor?: string;
  onClose: () => void;
}

/**
 * The moment collectible, full-screen. Renders the shareable poster on a canvas
 * (so "Save image" is one click and works everywhere) plus the on-chain
 * verification detail and a link to the Solana explorer.
 */
export function MomentCard({ moment, homeColor, awayColor, bgColor, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const v = moment.verification;

  const accent = moment.team === 2 ? awayColor : moment.team === 1 ? homeColor : "#a78bfa";
  const totalReactions = moment.reactions
    ? REACTIONS.reduce((n, t) => n + moment.reactions![t], 0)
    : 0;

  useEffect(() => {
    if (canvasRef.current) drawMomentPoster(canvasRef.current, moment, homeColor, awayColor, bgColor);
  }, [moment, homeColor, awayColor, bgColor]);

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.download = `pulse-moment-${moment.fixtureId}-${moment.seq}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  };

  return (
    <div className="moment-backdrop" onClick={onClose}>
      <div className="moment-modal" onClick={(e) => e.stopPropagation()}>
        <canvas ref={canvasRef} className="moment-canvas" />

        {(moment.curve?.length || totalReactions > 0 || moment.mvp) && (
          <div className="moment-stats">
            {moment.curve && moment.curve.length >= 2 && (
              <div className="stat-block">
                <div className="stat-label">
                  <span>Emotional surge</span>
                  <span>{Math.round(moment.intensity * 100)}% peak</span>
                </div>
                <Sparkline values={moment.curve} color={accent} />
              </div>
            )}

            {totalReactions > 0 && (
              <div className="reaction-breakdown">
                {REACTIONS.filter((t) => moment.reactions![t] > 0).map((t) => (
                  <span key={t} className="rb-item" style={{ ["--c" as string]: REACTION_META[t].color }}>
                    <span className="rb-emoji">{REACTION_META[t].emoji}</span>
                    <span className="rb-count">{moment.reactions![t]}</span>
                  </span>
                ))}
              </div>
            )}

            {moment.mvp && (
              <div className="fan-mvp">
                🎤 Loudest fan: <strong>{moment.mvp}</strong>
              </div>
            )}
          </div>
        )}

        <div className="moment-detail">
          {v.status === "verified" ? (
            <>
              <span className="badge verified">✓ Verified on Solana</span>
              <p className="moment-sub">
                This goal's Merkle proof was validated on-chain against the TxLINE
                daily-scores root — {moment.participants[0]} {moment.score[0]}–
                {moment.score[1]} {moment.participants[1]}.
              </p>
              <a className="explorer-link" href={v.explorer} target="_blank" rel="noreferrer">
                View daily-root account ↗
              </a>
            </>
          ) : v.status === "pending" ? (
            <span className="badge pending">◌ Verifying on-chain…</span>
          ) : (
            <>
              <span className="badge muted">Captured moment</span>
              <p className="moment-sub">{v.reason}</p>
            </>
          )}

          <div className="moment-actions">
            <button className="moment-btn primary" onClick={save}>
              Save image
            </button>
            <button className="moment-btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
