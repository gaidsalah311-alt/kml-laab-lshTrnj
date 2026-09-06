---
name: Chess state persistence
description: Rule-dependent state that must be restored with a chess position.
---

Castling rights and the en-passant target are part of a chess position, not just derived UI details. Persist them with the board, turn, history, and undo snapshots.

**Why:** Restoring only the pieces can incorrectly allow castling after a king or rook moved, or lose a one-turn en-passant capture after resume or undo.

**How to apply:** Any new move rule that depends on prior moves must be included in the saved game shape and every snapshot used by undo.