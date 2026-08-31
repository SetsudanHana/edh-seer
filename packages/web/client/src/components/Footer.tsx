/** THE FAN CONTENT NOTICE, AND THE DATA CREDITS.
 *
 *  This app shows Wizards' intellectual property — card names, oracle text, card art and the mana
 *  symbols — which the Fan Content Policy permits for a free, non-commercial fan site and which the
 *  policy also requires be labelled as unofficial. The first column is Wizards' own required
 *  wording; the second is the plain-language version of the same claim, in the shape every
 *  comparable deckbuilder states it.
 *
 *  THE CREDITS NAME ONLY WHAT THIS APP ACTUALLY USES. Scryfall supplies the card data, the art
 *  crops and the mana symbol SVGs; Commander Spellbook supplies the combos. There is deliberately
 *  no price disclaimer of the kind those sites carry — this app shows no prices at all, "cost" here
 *  is a mana cost, and a disclaimer about data we do not display would be noise pretending to be
 *  diligence.
 *
 *  THREE COLUMNS, NOT THREE STACKED PARAGRAPHS. First pass ran them full-width down the left of an
 *  unbounded page: 46ch of legal text against 1,900px of viewport, so two thirds of the band was
 *  empty and the notice read as body copy that happened to be last. Columns are this system's own
 *  answer to width (a wide viewport buys columns, never longer lines), and they group what is
 *  actually four separate statements — the required wording, the trademark disclaimer, where to
 *  report a bad claim, and the data credits — instead of running them together as one wall.
 *
 *  DESIGN.md's own note applies: if EDH Seer ever takes money, this is one of the things that has
 *  to be revisited, because the Fan Content Policy stops covering it. */
export function Footer() {
  return (
    <footer className="mt-6 border-t border-(--separator) pt-8 pb-2">
      <div className="grid gap-x-12 gap-y-6 md:grid-cols-2 lg:grid-cols-4 text-xs leading-relaxed text-(--muted)">
        <p className="max-w-[46ch]">
          EDH Seer is unofficial Fan Content permitted under the{" "}
          <FooterLink href="https://company.wizards.com/en/legal/fancontentpolicy">
            Wizards of the Coast Fan Content Policy
          </FooterLink>
          . Not approved or endorsed by Wizards. Portions of the materials used are property of
          Wizards of the Coast. ©Wizards of the Coast LLC.
        </p>
        <p className="max-w-[46ch]">
          Wizards of the Coast, Magic: The Gathering, and their logos are trademarks of Wizards of
          the Coast LLC in the United States and other countries. © 1993–2026 Wizards. All Rights
          Reserved. EDH Seer is not affiliated with, endorsed, sponsored, or specifically approved
          by Wizards of the Coast LLC — see{" "}
          <FooterLink href="https://company.wizards.com/">company.wizards.com</FooterLink>.
        </p>
        {/* THE ONE THING A READER MIGHT WANT TO DO THAT THE APP CANNOT DO FOR THEM. Every synergy
          *  claim here carries a stated reason, which is exactly what makes a WRONG one reportable:
          *  a reader can name the pair and quote the sentence. That belongs where the engine's other
          *  admissions live rather than behind a contact form this site has no server to run. */}
        <p className="max-w-[46ch]">
          A wrong edge, a missing one, or a card read badly?{" "}
          <FooterLink href="https://github.com/SetsudanHana/edh-seer/issues/new">
            Open an issue
          </FooterLink>{" "}
          with the two card names and the sentence it printed. The engine is rule-based and open
          source, so a bad claim is a fixable bug —{" "}
          <FooterLink href="https://github.com/SetsudanHana/edh-seer">
            github.com/SetsudanHana/edh-seer
          </FooterLink>
          .
        </p>
        <p className="max-w-[46ch]">
          Card data, card images and mana symbols are provided by{" "}
          <FooterLink href="https://scryfall.com/">Scryfall</FooterLink>, which is unaffiliated with
          this site. Combo data is provided by{" "}
          <FooterLink href="https://commanderspellbook.com/">Commander Spellbook</FooterLink>. This
          site shows no card prices.
        </p>
      </div>
    </footer>
  );
}

/** NOT THE ACCENT. These were magenta, which put the three brightest marks on the page inside its
 *  least important block -- the squint test landed on the legal notice. A link here separates from
 *  the muted text by LIGHTNESS, the way the rest of this system separates a value from its label,
 *  and takes the accent only on hover, where the reader has already chosen it. The underline is
 *  drawn in --muted rather than --border: at 12px on this ground a border-coloured rule is a
 *  half-pixel of #2c2338 that no one can see, which is an underline that does not underline.
 *
 *  `rel="noreferrer"` alongside `noopener`: these are outbound links to third parties named in a
 *  legal notice, and there is no reason to tell them which page the reader came from. */
function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-(--foreground) underline decoration-(--muted) underline-offset-2 transition-colors hover:text-(--accent) hover:decoration-(--accent)"
    >
      {children}
    </a>
  );
}
