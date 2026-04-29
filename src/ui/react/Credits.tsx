// @ts-nocheck
/*
 * Credits overlay — React port of the #credits-overlay contents in
 * index.html plus the build-time inject from vite.config.ts's
 * creditsBuildInjectPlugin. The outer #credits-overlay div (class
 * imprint-overlay) stays in index.html so the .open class toggle +
 * backdrop keeps working.
 *
 * Static sections (Game / Homage / Writing & more / Legal) are
 * duplicated verbatim from the old vanilla markup. The third-party
 * attribution sections (Art / Music / Sound effects / Engine & code)
 * are imported at runtime from src/credits.ts — same single source
 * of truth the Vite plugin reads to generate imprint.html's Credits
 * block, so the two surfaces can't drift.
 *
 * Item HTML comes from trusted static strings in src/credits.ts
 * (authored markup with embedded <a>, <code>, etc.), so
 * dangerouslySetInnerHTML is the correct tool here.
 */
import { type MouseEvent, useEffect, useRef } from "react";
import { ATTRIBUTION_SECTIONS } from "../../credits";

export interface CreditsCallbacks {
  onClose: () => void;
}
export interface CreditsProps {
  callbacks: CreditsCallbacks;
}

export function Credits({ callbacks: cb }: CreditsProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    // Mirror openCredits()'s focus move — × button first so the
    // gamepad / keyboard user lands on the canonical back action.
    closeRef.current?.focus();
  }, []);

  const handleClose = (e: MouseEvent) => {
    e.stopPropagation();
    cb.onClose();
  };

  return (
    <div className="imprint-sheet credits-sheet">
      <button
        type="button"
        ref={closeRef}
        className="imprint-close"
        aria-label="Close"
        onClick={handleClose}
      >
        ×
      </button>
      <div className="credits-scroll">
        <h1 className="credits-heading" tabIndex={-1}>
          Credits
        </h1>
        <section className="credits-section">
          <h2>Game</h2>
          <p>
            Design, code, and everything else by{" "}
            <a href="https://portfolio.trebeljahr.com" target="_blank" rel="noreferrer noopener">
              Rico Trebeljahr
            </a>
            .
          </p>
        </section>
        {ATTRIBUTION_SECTIONS.map((s) => (
          <section key={s.id} className="credits-section">
            <h2>{s.title}</h2>
            {s.items.length === 1 ? (
              // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted credits content, no user input
              <p dangerouslySetInnerHTML={{ __html: s.items[0] }} />
            ) : (
              <ul className="credits-links">
                {s.items.map((item, i) => (
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted credits content, no user input
                  <li key={i} dangerouslySetInnerHTML={{ __html: item }} />
                ))}
              </ul>
            )}
          </section>
        ))}
        <section className="credits-section">
          <h2>Homage</h2>
          <p>
            A love letter to the Chrome "No Internet" dinosaur game, extended with a full day/night
            cycle, a rotating starfield, and the occasional visit from something weirder.
          </p>
        </section>
        <section className="credits-section">
          <h2>Writing &amp; more</h2>
          <ul className="credits-links">
            <li>
              <a href="https://ricos.site/newsletters" target="_blank" rel="noreferrer noopener">
                Rico's writing at ricos.site
              </a>
            </li>
            <li>
              <a
                href="https://github.com/trebeljahr/velociraptor"
                target="_blank"
                rel="noreferrer noopener"
              >
                Source on GitHub
              </a>
            </li>
          </ul>
        </section>
        <section className="credits-section credits-legal">
          <h2>Legal</h2>
          <ul className="credits-links">
            <li>
              <a
                href="https://raptor.trebeljahr.com/imprint.html"
                target="_blank"
                rel="noreferrer noopener"
              >
                Imprint / Impressum
              </a>
            </li>
            <li>
              <a
                href="https://raptor.trebeljahr.com/imprint.html#privacy"
                target="_blank"
                rel="noreferrer noopener"
              >
                Privacy policy
              </a>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
