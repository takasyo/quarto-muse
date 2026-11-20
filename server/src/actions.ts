// Actions for Quarto. The only server work is the "最強" (strongest) CPU:
// a near-full-width alpha-beta search with a transposition table,
// iterative deepening over a time budget, and exact endgame solving.
// It runs here, server-side, so it can think longer and keep a much
// larger transposition table than a phone browser tab should.
//
// The game itself is stateless: the client sends the full board with
// every request and keeps the match state. Nothing is stored.

import { defineAction, z, type ActionsModule } from "@hatch/space-sdk";
import { chooseGive, choosePlaceAndGive } from "./engine";

const boardSchema = z.array(z.number().int().min(-1).max(15)).length(16);

// Thinking-time budgets for the strongest level. Placing is the heavier
// decision (place + give), so it gets a little more time.
const PLACE_BUDGET_MS = 2600;
const GIVE_BUDGET_MS = 2000;

const moveResponse = z.object({
  cell: z.number().int().min(-1).max(15),
  give: z.number().int().min(-1).max(15),
  depth: z.number().int().min(0),
  solved: z.boolean(),
});

export const Actions = {
  saikyoPlace: defineAction({
    description:
      "Strongest-level CPU move: places the given piece on the board and chooses the next piece to hand to the player.",
    request: z.object({
      board: boardSchema,
      piece: z.number().int().min(0).max(15),
    }),
    response: moveResponse,
    async handler(_ctx, args) {
      const r = choosePlaceAndGive(args.board, args.piece, PLACE_BUDGET_MS);
      return { cell: r.cell, give: r.give, depth: r.depth, solved: r.solved };
    },
  }),

  saikyoGive: defineAction({
    description:
      "Strongest-level CPU move: chooses only the piece to hand to the player (used for the opening give).",
    request: z.object({
      board: boardSchema,
    }),
    response: moveResponse,
    async handler(_ctx, args) {
      const r = chooseGive(args.board, GIVE_BUDGET_MS);
      return { cell: -1, give: r.give, depth: r.depth, solved: r.solved };
    },
  }),
} satisfies ActionsModule;
