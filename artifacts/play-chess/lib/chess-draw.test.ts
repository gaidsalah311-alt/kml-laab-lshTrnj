import { describe, expect, it } from 'vitest';
import { countOccurrences, isInsufficientMaterial, DrawBoard } from './chess-draw';

const emptyBoard = (): DrawBoard => Array.from({ length: 8 }, () => Array(8).fill(null));

describe('draw rules', () => {
  it('recognizes bare kings and minor-piece endings', () => {
    const board = emptyBoard();
    board[0][4] = { side: 'black', kind: 'king' };
    board[7][4] = { side: 'white', kind: 'king' };
    expect(isInsufficientMaterial(board)).toBe(true);
    board[3][3] = { side: 'white', kind: 'knight' };
    expect(isInsufficientMaterial(board)).toBe(true);
  });

  it('recognizes same-colored bishops and rejects mating material', () => {
    const board = emptyBoard();
    board[0][4] = { side: 'black', kind: 'king' };
    board[7][4] = { side: 'white', kind: 'king' };
    board[2][2] = { side: 'white', kind: 'bishop' };
    board[5][5] = { side: 'black', kind: 'bishop' };
    expect(isInsufficientMaterial(board)).toBe(true);
    board[4][4] = { side: 'white', kind: 'rook' };
    expect(isInsufficientMaterial(board)).toBe(false);
  });

  it('counts repeated positions for the threefold rule', () => {
    expect(countOccurrences(['a', 'b', 'a', 'c', 'a'], 'a')).toBe(3);
  });
});