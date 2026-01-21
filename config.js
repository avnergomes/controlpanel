const VBP_OLD_GID = 1184050764;

const CONFIG = {
  pollMs: 60000,
  cacheMinutes: 10,
  maxLatest: 25,
  sites: [
    {
      key: "portfolio",
      name: "Portfolio",
      sheetId: "17wXvFfRcrl6bbzFMwX7TF7o99t7XBa3khQBC1Hroq5M",
      gids: ["1617126613"],
      kind: "portfolio",
    },
    {
      key: "vbp-parana",
      name: "VBP Parana",
      sheetId: "1SwbupTGRM0DXleSSg1lO_HllDZbTF6x39ryPJRh5UX4",
      gids: ["13565778", VBP_OLD_GID],
      kind: "vbp",
    },
    {
      key: "precos-florestais",
      name: "Precos Florestais",
      sheetId: "1Pz57YYeQxhSgHc10kzSM71akB2VzlhzK_pXxwVnvcGA",
      gids: ["997539922"],
      kind: "precos",
    },
  ],
};
