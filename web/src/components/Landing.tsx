import { EmotionCanvas } from "../viz/EmotionCanvas.tsx";
import type { Theme } from "../themes.ts";

interface Props {
  theme: Theme;
  /** Live fixture count, to make the CTA feel alive (0 while loading). */
  liveCount: number;
  onEnter: () => void;
}

/**
 * The landing page — PULSE's front door. The hero background is the REAL living
 * emotion canvas breathing idle (not a mockup), so the product sells itself the
 * second the page loads. One primary CTA into the match lobby.
 */
export function Landing({ theme, liveCount, onEnter }: Props) {
  return (
    <div className="landing">
      <div className="landing-canvas">
        <EmotionCanvas
          emotion={null}
          lastEvent={null}
          homeColor={theme.home}
          awayColor={theme.away}
          bgColor={theme.bg}
          lightColor={theme.light}
        />
      </div>
      <div className="landing-scrim" aria-hidden />

      <nav className="landing-nav">
        <span className="logo">
          PULSE<span className="logo-dot" />
        </span>
        <button className="nav-cta" onClick={onEnter}>
          {liveCount > 0 ? `${liveCount} matches live` : "Enter"} →
        </button>
      </nav>

      <main className="hero">
        <p className="hero-kicker">World Cup · live second screen</p>
        <h1 className="hero-title">
          Feel the match
          <br />
          <em>together.</em>
        </h1>
        <p className="hero-sub">
          Every tap of your crowd fuses with real on-pitch data into one living
          canvas — and the biggest emotional peaks are verified on Solana, forever.
        </p>
        <div className="hero-ctas">
          <button className="btn-primary" onClick={onEnter}>
            Enter a live match
          </button>
          <a className="btn-ghost" href="#how">
            How it works
          </a>
        </div>
      </main>

      <section id="how" className="features">
        <article className="feature-card">
          <span className="feature-icon">🫀</span>
          <h3>The emotion twin</h3>
          <p>
            The room's collective feeling, rendered live. It breathes when the match
            is quiet and erupts within a second of a real goal.
          </p>
        </article>
        <article className="feature-card">
          <span className="feature-icon">👥</span>
          <h3>Watch-party rooms</h3>
          <p>
            Pick your side, invite your friends with one link, and feel every
            cheer, panic and rage fuse into the same screen.
          </p>
        </article>
        <article className="feature-card">
          <span className="feature-icon">⛓️</span>
          <h3>Moments, verified</h3>
          <p>
            Emotional peaks become collectibles anchored to Merkle-proved match
            stats — validated on-chain against Solana, not just claimed.
          </p>
        </article>
      </section>

      <footer className="landing-footer">
        <span>Powered by TxLINE live match data</span>
        <span className="footer-dot">·</span>
        <span>Verified on Solana devnet</span>
        <span className="footer-dot">·</span>
        <span>TxODDS World Cup Hackathon</span>
      </footer>
    </div>
  );
}
