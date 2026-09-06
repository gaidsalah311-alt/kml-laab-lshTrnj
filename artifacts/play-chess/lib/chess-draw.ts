export type DrawPieceKind = 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';
export type DrawPiece = { side: 'white' | 'black'; kind: DrawPieceKind };
export type DrawBoard = (DrawPiece | null)[][];

export function isInsufficientMaterial(board: DrawBoard): boolean {
  const pieces = board.flat().filter((piece): piece is DrawPiece => piece !== null && piece.kind !== 'king');
  if (pieces.length === 0) return true;
  if (pieces.some((piece) => piece.kind === 'pawn' || piece.kind === 'rook' || piece.kind === 'queen')) return false;
  if (pieces.length === 1) return pieces[0].kind === 'bishop' || pieces[0].kind === 'knight';
  if (pieces.length === 2 && pieces.every((piece) => piece.kind === 'bishop')) {
    const bishopSquares = board.flatMap((row, rowIndex) => row.map((piece, colIndex) => (
      piece?.kind === 'bishop' ? (rowIndex + colIndex) % 2 : null
    )).filter((value): value is number => value !== null));
    return bishopSquares.length === 2 && bishopSquares[0] === bishopSquares[1];
  }
  return false;
}

export function countOccurrences(values: string[], value: string): number {
  return values.reduce((count, current) => count + (current === value ? 1 : 0), 0);
}