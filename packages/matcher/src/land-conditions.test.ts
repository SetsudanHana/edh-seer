import { describe, expect, test } from "vitest";
import { classifyLand, entersTapped, type LandBoard } from "./land-conditions.js";

/** Oracle text FETCHED FROM THE CORPUS, never typed from memory (the standing rule). */
const CARDS = {
  sundownPass: { typeLine: "Land", oracleText: "This land enters tapped unless you control two or more other lands.\n{T}: Add {R} or {W}." },
  blackcleave: { typeLine: "Land", oracleText: "This land enters tapped unless you control two or fewer other lands.\n{T}: Add {B} or {R}." },
  cinderGlade: { typeLine: "Land — Mountain Forest", oracleText: "({T}: Add {R} or {G}.)\nThis land enters tapped unless you control two or more basic lands." },
  rootboundCrag: { typeLine: "Land", oracleText: "This land enters tapped unless you control a Mountain or a Forest.\n{T}: Add {R} or {G}." },
  spectatorSeating: { typeLine: "Land", oracleText: "This land enters tapped unless you have two or more opponents.\n{T}: Add {R} or {W}." },
  stompingGround: { typeLine: "Land — Mountain Forest", oracleText: "({T}: Add {R} or {G}.)\nAs this land enters, you may pay 2 life. If you don't, it enters tapped." },
  seaGate: { typeLine: "Sorcery // Land", oracleText: "Draw cards equal to the number of cards in your hand plus one.\n//\nAs this land enters, you may pay 3 life. If you don't, it enters tapped.\n{T}: Add {U}." },
  portTown: { typeLine: "Land", oracleText: "As this land enters, you may reveal a Plains or Island card from your hand. If you don't, this land enters tapped.\n{T}: Add {W} or {U}." },
  thornspireVerge: { typeLine: "Land", oracleText: "{T}: Add {R}.\n{T}: Add {G}. Activate only if you control a Mountain or a Forest." },
  gruulTurf: { typeLine: "Land", oracleText: "This land enters tapped.\nWhen this land enters, return a land you control to its owner's hand.\n{T}: Add {R}{G}." },
  templeOfEpiphany: { typeLine: "Land", oracleText: "This land enters tapped.\nWhen this land enters, scry 1.\n{T}: Add {U} or {R}." },
  evolvingWilds: { typeLine: "Land", oracleText: "{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle." },
  shivanReef: { typeLine: "Land", oracleText: "{T}: Add {C}.\n{T}: Add {U} or {R}. This land deals 1 damage to you." },
};

const board = (o: Partial<LandBoard> = {}): LandBoard =>
  ({ lands: 0, basics: 0, types: new Set(), opponents: 3, ...o });

describe("classifyLand", () => {
  test.each([
    ["sundownPass", "slow", 2],
    ["blackcleave", "fast", 2],
    ["cinderGlade", "bfz", 2],
    ["spectatorSeating", "pod", 2],
    ["stompingGround", "shock", 2],
    ["seaGate", "pay-life", 3],
  ] as const)("%s is %s", (key, template, count) => {
    const c = classifyLand(CARDS[key]);
    expect(c.template).toBe(template);
    expect(c.count).toBe(count);
  });

  test("a check land names the SUBTYPES it wants — that is what I9's edge reads", () => {
    expect(classifyLand(CARDS.rootboundCrag)).toMatchObject({
      template: "check", subtypes: ["mountain", "forest"],
    });
  });

  test("a verge land is an ACTIVATION restriction, not a tapped one", () => {
    const c = classifyLand(CARDS.thornspireVerge);
    expect(c.template).toBe("verge");
    expect(c.subtypes).toEqual(["mountain", "forest"]);
    expect(entersTapped(c, board())).toBe(false);
  });

  test("Evolving Wilds enters UNTAPPED — the tapped clause is about the land it fetches", () => {
    expect(classifyLand(CARDS.evolvingWilds).template).toBe("none");
  });

  test("a land with no tapped clause at all is `none`", () => {
    expect(classifyLand(CARDS.shivanReef).template).toBe("none");
  });

  test("a Karoo is unconditionally tapped AND flagged as bouncing — the bounce breaks a land count, which no tapped flag can say", () => {
    expect(classifyLand(CARDS.gruulTurf)).toMatchObject({ template: "unconditional", bounces: true });
    expect(classifyLand(CARDS.templeOfEpiphany)).toMatchObject({ template: "unconditional", bounces: false });
  });
});

describe("entersTapped fires in BOTH directions", () => {
  test("Sundown Pass: tapped as the first drop, untapped as the third", () => {
    const c = classifyLand(CARDS.sundownPass);
    expect(entersTapped(c, board({ lands: 0 }))).toBe(true);
    expect(entersTapped(c, board({ lands: 1 }))).toBe(true);
    expect(entersTapped(c, board({ lands: 2 }))).toBe(false);
  });

  test("Blackcleave Cliffs runs the OTHER way — untapped early, tapped late", () => {
    const c = classifyLand(CARDS.blackcleave);
    expect(entersTapped(c, board({ lands: 2 }))).toBe(false);
    expect(entersTapped(c, board({ lands: 3 }))).toBe(true);
  });

  test("Cinder Glade counts the SUPERTYPE: two basics untaps it, two shocklands do not", () => {
    const c = classifyLand(CARDS.cinderGlade);
    expect(entersTapped(c, board({ basics: 1, lands: 5 }))).toBe(true);
    expect(entersTapped(c, board({ basics: 2 }))).toBe(false);
    // Cinder Glade is `Land — Mountain Forest` and is NOT basic, so it never satisfies itself.
    expect(entersTapped(c, board({ basics: 0, types: new Set(["mountain", "forest"]) }))).toBe(true);
  });

  test("Rootbound Crag counts the SUBTYPE: a Mountain untaps it, a pile of basics of the wrong type does not", () => {
    const c = classifyLand(CARDS.rootboundCrag);
    expect(entersTapped(c, board({ basics: 6, types: new Set(["island"]) }))).toBe(true);
    expect(entersTapped(c, board({ types: new Set(["mountain"]) }))).toBe(false);
  });

  test("Spectator Seating is a FORMAT fact: untapped in a pod, tapped in a duel", () => {
    const c = classifyLand(CARDS.spectatorSeating);
    expect(entersTapped(c, board({ opponents: 3 }))).toBe(false);
    expect(entersTapped(c, board({ opponents: 1 }))).toBe(true);
  });

  test("paying life is a cost, not a condition — never tapped, whatever the board", () => {
    expect(entersTapped(classifyLand(CARDS.stompingGround), board())).toBe(false);
    expect(entersTapped(classifyLand(CARDS.seaGate), board())).toBe(false);
  });

  test("a condition the board cannot answer defaults to TAPPED, not untapped", () => {
    // Port Town reads your HAND. Nothing here can, so it is charged the turn.
    expect(classifyLand(CARDS.portTown).template).toBe("reveal");
    expect(entersTapped(classifyLand(CARDS.portTown), board({ types: new Set(["plains"]) }))).toBe(true);
    expect(entersTapped({ template: "unclassified", subtypes: [], bounces: false }, board())).toBe(true);
  });
});

describe("the residual bucket is real, and naming it is the point", () => {
  // Every one of these is a printed demand the eight templates do not express. They are recorded
  // as `unclassified` and charged the turn, rather than guessed at. Measured over the corpus:
  // legendary creature 7 · Mount or Vehicle 5 · colour permanent 1 · Equipment 1.
  const RESIDUAL = {
    rivendell: "Rivendell enters tapped unless you control a legendary creature.\n{T}: Add {U}.",
    reefRoads: "This land enters tapped unless you control a Mount or Vehicle.\n{T}: Add {U}.",
    taigaStadium: "Taiga Stadium enters tapped unless you control a white, blue, or black permanent.\n{T}: Add {R} or {G}.",
    lonelyMountain: "({T}: Add {R}.)\nThis land enters tapped unless you control an Equipment.",
  };
  test.each(Object.entries(RESIDUAL))("%s is unclassified, not silently misread", (_name, oracleText) => {
    const c = classifyLand({ typeLine: "Land", oracleText });
    expect(c.template).toBe("unclassified");
    expect(entersTapped(c, board({ lands: 9, basics: 9, types: new Set(["mountain", "forest"]) }))).toBe(true);
  });

  test("'unless you control a basic land' is the bfz SUPERTYPE demand at count 1, not a subtype one", () => {
    const c = classifyLand({ typeLine: "Land", oracleText: "This land enters tapped unless you control a basic land.\n{T}: Add {U}." });
    expect(c).toMatchObject({ template: "bfz", count: 1, subtypes: [] });
    expect(entersTapped(c, board({ basics: 0, types: new Set(["island"]) }))).toBe(true);
    expect(entersTapped(c, board({ basics: 1 }))).toBe(false);
  });
});

describe("a live condition can never reach `unconditional` — the guard the bucket depends on", () => {
  // Every one of these read `unconditional` before the guard: a bare "enters tapped" matched and
  // answered, so the cards MOST in need of the residual bucket were the ones that never landed in
  // it. Texts are the printed cycles, shortened to the clause under test.
  test.each([
    ["Duskmourn 13-or-less-life", "This land enters tapped unless you have 13 or less life."],
    ["Eldraine three-or-more Islands", "This land enters tapped unless you control three or more other Islands."],
    ["opponents' land count", "This land enters tapped unless an opponent controls eight or more lands."],
  ])("%s is unclassified, not unconditional", (_n, oracleText) => {
    expect(classifyLand({ typeLine: "Land", oracleText }).template).toBe("unclassified");
  });

  test("the AFR frame states it inverted, and it is `fast` one count lower", () => {
    // "If you control two or more other lands, this land enters tapped" — tapped AT two, so
    // untapped at one or fewer.
    const c = classifyLand({ typeLine: "Land", oracleText: "If you control two or more other lands, this land enters tapped.\n{T}: Add {U}." });
    expect(c).toMatchObject({ template: "fast", count: 1 });
    expect(entersTapped(c, board({ lands: 1 }))).toBe(false);
    expect(entersTapped(c, board({ lands: 2 }))).toBe(true);
  });
});

describe("a multi-face card is classified on its LAND face", () => {
  test("a front face paying life must not make the land back a shockland", () => {
    // The flattering direction, and therefore the one that matters: read whole, this classifies
    // `pay-life` and hands back an UNTAPPED land that always enters tapped.
    const c = classifyLand({
      typeLine: "Sorcery // Land",
      oracleText: "As an additional cost, you may pay 3 life.\n//\nThis land enters tapped.\n{T}: Add {G}.",
    });
    expect(c.template).toBe("unconditional");
    expect(entersTapped(c, board())).toBe(true);
  });

  test("a real MDFC land back still reads its own pay-life clause", () => {
    const c = classifyLand({
      typeLine: "Sorcery // Land",
      oracleText: "Draw cards equal to the number of cards in your hand plus one.\n//\nAs this land enters, you may pay 3 life. If you don't, it enters tapped.\n{T}: Add {U}.",
    });
    expect(c).toMatchObject({ template: "pay-life", count: 3 });
  });
});
