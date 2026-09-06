import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { createStockfishEngine, StockfishEngine } from '@/lib/stockfish';
import { AD_MODE, shouldShowInterstitial, showRewardedAd } from '@/lib/ads';
import { countOccurrences, isInsufficientMaterial } from '@/lib/chess-draw';
import { playSound } from '@/lib/sound';

type Side = 'white' | 'black';
type PieceKind = 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';
type Piece = { side: Side; kind: PieceKind };
type Square = Piece | null;
type Board = Square[][];
type Position = { row: number; col: number };
type GameMode = 'local' | 'computer';
type DifficultyId = 'beginner' | 'easy' | 'medium' | 'hard' | 'expert';
type PromotionKind = 'queen' | 'rook' | 'bishop' | 'knight';
type MoveSpecial = 'normal' | 'castle' | 'enPassant';
type CastlingRights = {
  whiteKingSide: boolean;
  whiteQueenSide: boolean;
  blackKingSide: boolean;
  blackQueenSide: boolean;
};
type Move = {
  from: Position;
  to: Position;
  piece: Piece;
  captured: Piece | null;
  special: MoveSpecial;
  promotion?: PromotionKind;
  san?: string;
};
type GameSettings = {
  timerEnabled: boolean;
  timerMinutes: number;
  showCoordinates: boolean;
  aiDifficulty: DifficultyId;
  soundEnabled: boolean;
};
type GameStats = {
  games: number;
  wins: number;
  losses: number;
  draws: number;
};
type GameStatus =
  | 'playing'
  | 'checkmate'
  | 'stalemate'
  | 'timeout'
  | 'drawInsufficientMaterial'
  | 'drawThreefold'
  | 'drawFiftyMove'
  | 'resigned'
  | 'agreedDraw';

const DEFAULT_SETTINGS: GameSettings = {
  timerEnabled: true,
  timerMinutes: 10,
  showCoordinates: true,
  aiDifficulty: 'medium',
  soundEnabled: true,
};
const DEFAULT_STATS: GameStats = { games: 0, wins: 0, losses: 0, draws: 0 };
const INITIAL_CASTLING_RIGHTS: CastlingRights = {
  whiteKingSide: true,
  whiteQueenSide: true,
  blackKingSide: true,
  blackQueenSide: true,
};
const DIFFICULTIES: {
  id: DifficultyId;
  label: string;
  description: string;
  depth: number;
  skill: number;
}[] = [
  { id: 'beginner', label: 'مبتدئ', description: 'نقلة بسيطة', depth: 1, skill: 1 },
  { id: 'easy', label: 'سهل', description: 'بداية هادئة', depth: 2, skill: 5 },
  { id: 'medium', label: 'متوسط', description: 'تحدٍ متوازن', depth: 3, skill: 10 },
  { id: 'hard', label: 'صعب', description: 'قرارات دقيقة', depth: 4, skill: 15 },
  { id: 'expert', label: 'خبير', description: 'أقصى تركيز', depth: 5, skill: 20 },
];

const STORAGE_KEY = 'play-chess-saved-game';
const SETTINGS_KEY = 'play-chess-settings';
const STATS_KEY = 'play-chess-stats';
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const PIECES: Record<Side, Record<PieceKind, string>> = {
  white: {
    king: '♔',
    queen: '♕',
    rook: '♖',
    bishop: '♗',
    knight: '♘',
    pawn: '♙',
  },
  black: {
    king: '♚',
    queen: '♛',
    rook: '♜',
    bishop: '♝',
    knight: '♞',
    pawn: '♟',
  },
};

const PIECE_VALUES: Record<PieceKind, number> = {
  pawn: 1,
  knight: 3,
  bishop: 3,
  rook: 5,
  queen: 9,
  king: 100,
};

function squareToUci(position: Position): string {
  return `${FILES[position.col]}${8 - position.row}`;
}

function moveToUci(move: Move): string {
  const promotion = move.promotion
    ? move.promotion === 'knight'
      ? 'n'
      : move.promotion[0]
    : move.piece.kind === 'pawn' && (move.to.row === 0 || move.to.row === 7)
      ? 'q'
      : '';
  return `${squareToUci(move.from)}${squareToUci(move.to)}${promotion}`;
}

function parseUciMove(uci: string): { from: Position; to: Position; promotion?: PromotionKind } | null {
  const match = uci.trim().match(/^([a-h])([1-8])([a-h])([1-8])(?:[qrbn])?$/);
  if (!match) return null;
  const from = { row: 8 - Number(match[2]), col: FILES.indexOf(match[1]) };
  const to = { row: 8 - Number(match[4]), col: FILES.indexOf(match[3]) };
  const promotionLetter = uci.trim().slice(4).toLowerCase();
  const promotion = promotionLetter
    ? ({ q: 'queen', r: 'rook', b: 'bishop', n: 'knight' } as const)[promotionLetter]
    : undefined;
  return from.col >= 0 && to.col >= 0 ? { from, to, promotion } : null;
}

function createInitialBoard(): Board {
  const backRank: PieceKind[] = [
    'rook',
    'knight',
    'bishop',
    'queen',
    'king',
    'bishop',
    'knight',
    'rook',
  ];
  const board: Board = Array.from({ length: 8 }, () => Array<Square>(8).fill(null));
  for (let col = 0; col < 8; col += 1) {
    board[0][col] = { side: 'black', kind: backRank[col] };
    board[1][col] = { side: 'black', kind: 'pawn' };
    board[6][col] = { side: 'white', kind: 'pawn' };
    board[7][col] = { side: 'white', kind: backRank[col] };
  }
  return board;
}

function copyBoard(board: Board): Board {
  return board.map((row) => row.map((piece) => (piece ? { ...piece } : null)));
}

function isInside(row: number, col: number): boolean {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

function samePosition(a: Position, b: Position): boolean {
  return a.row === b.row && a.col === b.col;
}

function otherSide(side: Side): Side {
  return side === 'white' ? 'black' : 'white';
}

function copyCastlingRights(rights: CastlingRights): CastlingRights {
  return { ...rights };
}

function updateCastlingRights(
  rights: CastlingRights,
  piece: Piece,
  from: Position,
  to: Position,
  captured: Piece | null,
): CastlingRights {
  const next = copyCastlingRights(rights);
  if (piece.kind === 'king') {
    if (piece.side === 'white') {
      next.whiteKingSide = false;
      next.whiteQueenSide = false;
    } else {
      next.blackKingSide = false;
      next.blackQueenSide = false;
    }
  }
  if (piece.kind === 'rook') {
    if (piece.side === 'white' && from.row === 7 && from.col === 0) next.whiteQueenSide = false;
    if (piece.side === 'white' && from.row === 7 && from.col === 7) next.whiteKingSide = false;
    if (piece.side === 'black' && from.row === 0 && from.col === 0) next.blackQueenSide = false;
    if (piece.side === 'black' && from.row === 0 && from.col === 7) next.blackKingSide = false;
  }
  if (captured?.kind === 'rook') {
    if (captured.side === 'white' && to.row === 7 && to.col === 0) next.whiteQueenSide = false;
    if (captured.side === 'white' && to.row === 7 && to.col === 7) next.whiteKingSide = false;
    if (captured.side === 'black' && to.row === 0 && to.col === 0) next.blackQueenSide = false;
    if (captured.side === 'black' && to.row === 0 && to.col === 7) next.blackKingSide = false;
  }
  return next;
}

function deriveCastlingRights(history: Move[]): CastlingRights {
  return history.reduce(
    (rights, move) => updateCastlingRights(rights, move.piece, move.from, move.to, move.captured),
    copyCastlingRights(INITIAL_CASTLING_RIGHTS),
  );
}

function findKing(board: Board, side: Side): Position | null {
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const piece = board[row][col];
      if (piece?.side === side && piece.kind === 'king') return { row, col };
    }
  }
  return null;
}

function slideMoves(
  board: Board,
  from: Position,
  directions: Position[],
  attackOnly = false,
): Position[] {
  const piece = board[from.row][from.col];
  if (!piece) return [];
  const moves: Position[] = [];
  directions.forEach((direction) => {
    let row = from.row + direction.row;
    let col = from.col + direction.col;
    while (isInside(row, col)) {
      const target = board[row][col];
      if (!target) {
        moves.push({ row, col });
      } else {
        if (target.side !== piece.side && (attackOnly || target.kind !== 'king')) {
          moves.push({ row, col });
        }
        break;
      }
      row += direction.row;
      col += direction.col;
    }
  });
  return moves;
}

function pseudoMoves(
  board: Board,
  from: Position,
  attackOnly = false,
  castlingRights: CastlingRights = INITIAL_CASTLING_RIGHTS,
  enPassantTarget: Position | null = null,
): Position[] {
  const piece = board[from.row][from.col];
  if (!piece) return [];
  const moves: Position[] = [];
  const push = (row: number, col: number) => {
    if (!isInside(row, col)) return;
    const target = board[row][col];
    if (!target || (target.side !== piece.side && (attackOnly || target.kind !== 'king'))) {
      moves.push({ row, col });
    }
  };

  if (piece.kind === 'pawn') {
    const direction = piece.side === 'white' ? -1 : 1;
    if (attackOnly) {
      push(from.row + direction, from.col - 1);
      push(from.row + direction, from.col + 1);
    } else {
      if (isInside(from.row + direction, from.col) && !board[from.row + direction][from.col]) {
        moves.push({ row: from.row + direction, col: from.col });
        const startRow = piece.side === 'white' ? 6 : 1;
        if (from.row === startRow && !board[from.row + direction * 2][from.col]) {
          moves.push({ row: from.row + direction * 2, col: from.col });
        }
      }
      [-1, 1].forEach((colOffset) => {
        const row = from.row + direction;
        const col = from.col + colOffset;
        if (isInside(row, col) && board[row][col]?.side === otherSide(piece.side)) {
          moves.push({ row, col });
        } else if (
          !attackOnly &&
          enPassantTarget &&
          enPassantTarget.row === row &&
          enPassantTarget.col === col
        ) {
          moves.push({ row, col });
        }
      });
    }
  }

  if (piece.kind === 'knight') {
    [
      [-2, -1],
      [-2, 1],
      [-1, -2],
      [-1, 2],
      [1, -2],
      [1, 2],
      [2, -1],
      [2, 1],
    ].forEach(([row, col]) => push(from.row + row, from.col + col));
  }
  if (piece.kind === 'bishop' || piece.kind === 'queen') {
    moves.push(
      ...slideMoves(board, from, [
        { row: -1, col: -1 },
        { row: -1, col: 1 },
        { row: 1, col: -1 },
        { row: 1, col: 1 },
      ], attackOnly),
    );
  }
  if (piece.kind === 'rook' || piece.kind === 'queen') {
    moves.push(
      ...slideMoves(board, from, [
        { row: -1, col: 0 },
        { row: 1, col: 0 },
        { row: 0, col: -1 },
        { row: 0, col: 1 },
      ], attackOnly),
    );
  }
  if (piece.kind === 'king') {
    for (let row = -1; row <= 1; row += 1) {
      for (let col = -1; col <= 1; col += 1) {
        if (row !== 0 || col !== 0) push(from.row + row, from.col + col);
      }
    }
    if (!attackOnly && (from.col === 4) && !isInCheck(board, piece.side)) {
      const homeRow = piece.side === 'white' ? 7 : 0;
      const kingSideAllowed = piece.side === 'white'
        ? castlingRights.whiteKingSide
        : castlingRights.blackKingSide;
      const queenSideAllowed = piece.side === 'white'
        ? castlingRights.whiteQueenSide
        : castlingRights.blackQueenSide;
      const opponent = otherSide(piece.side);
      const kingSideRook = board[homeRow][7];
      if (
        from.row === homeRow &&
        kingSideAllowed &&
        kingSideRook?.side === piece.side &&
        kingSideRook.kind === 'rook' &&
        !board[homeRow][5] &&
        !board[homeRow][6] &&
        !isSquareAttacked(board, { row: homeRow, col: 5 }, opponent) &&
        !isSquareAttacked(board, { row: homeRow, col: 6 }, opponent)
      ) {
        moves.push({ row: homeRow, col: 6 });
      }
      const queenSideRook = board[homeRow][0];
      if (
        from.row === homeRow &&
        queenSideAllowed &&
        queenSideRook?.side === piece.side &&
        queenSideRook.kind === 'rook' &&
        !board[homeRow][1] &&
        !board[homeRow][2] &&
        !board[homeRow][3] &&
        !isSquareAttacked(board, { row: homeRow, col: 3 }, opponent) &&
        !isSquareAttacked(board, { row: homeRow, col: 2 }, opponent)
      ) {
        moves.push({ row: homeRow, col: 2 });
      }
    }
  }
  return moves;
}

function isSquareAttacked(board: Board, square: Position, bySide: Side): boolean {
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const piece = board[row][col];
      if (piece?.side === bySide) {
        if (pseudoMoves(board, { row, col }, true).some((move) => samePosition(move, square))) {
          return true;
        }
      }
    }
  }
  return false;
}

function isInCheck(board: Board, side: Side): boolean {
  const king = findKing(board, side);
  return king ? isSquareAttacked(board, king, otherSide(side)) : true;
}

function applyMove(
  board: Board,
  from: Position,
  to: Position,
  promotion: PromotionKind = 'queen',
  enPassantTarget: Position | null = null,
): Board {
  const next = copyBoard(board);
  const piece = next[from.row][from.col];
  if (!piece) return next;
  const direction = piece.side === 'white' ? -1 : 1;
  if (
    piece.kind === 'pawn' &&
    enPassantTarget &&
    samePosition(to, enPassantTarget) &&
    !board[to.row][to.col]
  ) {
    next[to.row - direction][to.col] = null;
  }
  next[to.row][to.col] = piece;
  next[from.row][from.col] = null;
  if (piece.kind === 'king' && Math.abs(to.col - from.col) === 2) {
    const rookFromCol = to.col > from.col ? 7 : 0;
    const rookToCol = to.col > from.col ? 5 : 3;
    next[to.row][rookToCol] = next[to.row][rookFromCol];
    next[to.row][rookFromCol] = null;
  }
  if (piece.kind === 'pawn' && (to.row === 0 || to.row === 7)) {
    next[to.row][to.col] = { side: piece.side, kind: promotion };
  }
  return next;
}

function legalMoves(
  board: Board,
  from: Position,
  castlingRights: CastlingRights = INITIAL_CASTLING_RIGHTS,
  enPassantTarget: Position | null = null,
): Position[] {
  const piece = board[from.row][from.col];
  if (!piece) return [];
  return pseudoMoves(board, from, false, castlingRights, enPassantTarget).filter((to) => {
    const target = board[to.row][to.col];
    if (target?.kind === 'king') return false;
    return !isInCheck(applyMove(board, from, to, 'queen', enPassantTarget), piece.side);
  });
}

function allLegalMoves(
  board: Board,
  side: Side,
  castlingRights: CastlingRights = INITIAL_CASTLING_RIGHTS,
  enPassantTarget: Position | null = null,
): { from: Position; to: Position }[] {
  const moves: { from: Position; to: Position }[] = [];
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      if (board[row][col]?.side === side) {
        legalMoves(board, { row, col }, castlingRights, enPassantTarget)
          .forEach((to) => moves.push({ from: { row, col }, to }));
      }
    }
  }
  return moves;
}

function pieceSanLetter(kind: PieceKind): string {
  return kind === 'knight' ? 'N' : kind === 'bishop' ? 'B' : kind === 'rook' ? 'R' : kind === 'queen' ? 'Q' : kind === 'king' ? 'K' : '';
}

function positionKey(
  board: Board,
  turn: Side,
  castlingRights: CastlingRights,
  enPassantTarget: Position | null,
): string {
  const boardKey = board.map((row) => row.map((piece) => piece ? `${piece.side[0]}${piece.kind[0]}` : '--').join('')).join('/');
  const rightsKey = [
    castlingRights.whiteKingSide ? 'K' : '',
    castlingRights.whiteQueenSide ? 'Q' : '',
    castlingRights.blackKingSide ? 'k' : '',
    castlingRights.blackQueenSide ? 'q' : '',
  ].join('') || '-';
  return `${boardKey} ${turn[0]} ${rightsKey} ${enPassantTarget ? squareToUci(enPassantTarget) : '-'}`;
}

function formatSan(
  move: Move,
  board: Board,
  castlingRights: CastlingRights,
  enPassantTarget: Position | null,
  nextBoard: Board,
  nextTurn: Side,
  nextMoves: { from: Position; to: Position }[],
): string {
  if (move.special === 'castle') return move.to.col > move.from.col ? 'O-O' : 'O-O-O';
  const capture = Boolean(move.captured) || move.special === 'enPassant';
  let notation = pieceSanLetter(move.piece.kind);
  if (move.piece.kind === 'pawn' && capture) notation += FILES[move.from.col];
  if (move.piece.kind !== 'pawn') {
    const alternatives = allLegalMoves(board, move.piece.side, castlingRights, enPassantTarget)
      .filter((candidate) => samePosition(candidate.to, move.to) && !samePosition(candidate.from, move.from))
      .filter((candidate) => board[candidate.from.row][candidate.from.col]?.kind === move.piece.kind);
    if (alternatives.length > 0) {
      const sameFile = alternatives.some((candidate) => candidate.from.col === move.from.col);
      const sameRank = alternatives.some((candidate) => candidate.from.row === move.from.row);
      notation += sameFile && sameRank ? `${FILES[move.from.col]}${8 - move.from.row}` : sameFile ? `${8 - move.from.row}` : FILES[move.from.col];
    }
  }
  if (capture) notation += 'x';
  notation += squareToUci(move.to);
  if (move.promotion) notation += `=${pieceSanLetter(move.promotion)}`;
  if (nextMoves.length === 0 && isInCheck(nextBoard, nextTurn)) notation += '#';
  else if (isInCheck(nextBoard, nextTurn)) notation += '+';
  return notation;
}

function formatMove(move: Move): string {
  return move.san ?? (move.special === 'castle'
    ? (move.to.col > move.from.col ? 'O-O' : 'O-O-O')
    : `${PIECES[move.piece.side][move.piece.kind]} ${squareToUci(move.from)} إلى ${squareToUci(move.to)}`);
}

function chooseComputerMove(
  board: Board,
  castlingRights: CastlingRights,
  enPassantTarget: Position | null,
): { from: Position; to: Position } | null {
  const moves = allLegalMoves(board, 'black', castlingRights, enPassantTarget);
  if (moves.length === 0) return null;

  return moves
    .map((move) => {
      const captured = board[move.to.row][move.to.col];
      const nextBoard = applyMove(board, move.from, move.to, 'queen', enPassantTarget);
      const nextCastlingRights = updateCastlingRights(
        castlingRights,
        board[move.from.row][move.from.col] as Piece,
        move.from,
        move.to,
        captured,
      );
      const nextEnPassantTarget = move.from.row === 1 && move.to.row === 3
        ? { row: 2, col: move.from.col }
        : null;
      const whiteMoves = allLegalMoves(nextBoard, 'white', nextCastlingRights, nextEnPassantTarget);
      const checkmateBonus = whiteMoves.length === 0 && isInCheck(nextBoard, 'white') ? 1000 : 0;
      const centerBonus = 4 - Math.abs(3.5 - move.to.col) - Math.abs(3.5 - move.to.row);
      const captureBonus = captured ? PIECE_VALUES[captured.kind] * 10 : 0;
      const promotionBonus = move.from.row === 1 && move.to.row === 7 ? 80 : 0;
      return {
        move,
        score: checkmateBonus + captureBonus + promotionBonus + centerBonus,
      };
    })
    .sort((a, b) => b.score - a.score)[0].move;
}

function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

function Button({
  children,
  onPress,
  variant = 'primary',
  icon,
  disabled = false,
  testID,
}: {
  children: React.ReactNode;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  icon?: keyof typeof Feather.glyphMap;
  disabled?: boolean;
  testID?: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={() => {
        if (!disabled) {
          void Haptics.selectionAsync();
          onPress();
        }
      }}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && { backgroundColor: colors.primary },
        variant === 'secondary' && {
          backgroundColor: colors.secondary,
          borderColor: colors.border,
          borderWidth: 1,
        },
        variant === 'ghost' && { backgroundColor: 'transparent' },
        disabled && { opacity: 0.4 },
        pressed && !disabled && styles.pressed,
      ]}
    >
      {icon ? (
        <Feather
          name={icon}
          size={17}
          color={variant === 'primary' ? colors.primaryForeground : colors.foreground}
        />
      ) : null}
      <Text
        style={[
          styles.buttonText,
          { color: variant === 'primary' ? colors.primaryForeground : colors.foreground },
        ]}
      >
        {children}
      </Text>
    </Pressable>
  );
}

function SettingRow({
  icon,
  title,
  description,
  value,
  onToggle,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  description: string;
  value: boolean;
  onToggle: () => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.settingRow}>
      <View style={[styles.settingIcon, { backgroundColor: colors.secondary }]}>
        <Feather name={icon} size={16} color={colors.primary} />
      </View>
      <View style={styles.settingCopy}>
        <Text style={[styles.settingTitle, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.settingDescription, { color: colors.mutedForeground }]}>{description}</Text>
      </View>
      <Pressable
        testID={`${title}-toggle`}
        accessibilityRole="switch"
        accessibilityState={{ checked: value }}
        onPress={onToggle}
        style={[styles.toggle, { backgroundColor: value ? colors.primary : colors.muted }]}
      >
        <View style={[styles.toggleThumb, { backgroundColor: colors.card, alignSelf: value ? 'flex-end' : 'flex-start' }]} />
      </Pressable>
    </View>
  );
}

function HomeScreen({ onStart }: { onStart: (mode: GameMode, resume?: boolean, difficulty?: DifficultyId) => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [hasSavedGame, setHasSavedGame] = useState(false);
  const [savedMode, setSavedMode] = useState<GameMode>('local');
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_SETTINGS);
  const [stats, setStats] = useState<GameStats>(DEFAULT_STATS);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(STORAGE_KEY),
      AsyncStorage.getItem(SETTINGS_KEY),
      AsyncStorage.getItem(STATS_KEY),
    ]).then(([saved, savedSettings, savedStats]) => {
      setHasSavedGame(Boolean(saved));
      if (saved) {
        try {
          const savedGame = JSON.parse(saved) as { mode?: GameMode };
          if (savedGame.mode === 'computer') setSavedMode('computer');
        } catch {
          setSavedMode('local');
        }
      }
      if (savedSettings) {
        try {
          setSettings({ ...DEFAULT_SETTINGS, ...(JSON.parse(savedSettings) as Partial<GameSettings>) });
        } catch {
          setSettings(DEFAULT_SETTINGS);
        }
      }
      if (savedStats) {
        try {
          setStats({ ...DEFAULT_STATS, ...(JSON.parse(savedStats) as Partial<GameStats>) });
        } catch {
          setStats(DEFAULT_STATS);
        }
      }
    });
  }, []);

  const updateSettings = (patch: Partial<GameSettings>) => {
    const nextSettings = { ...settings, ...patch };
    setSettings(nextSettings);
    void AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(nextSettings));
  };

  return (
    <View style={[styles.page, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.homeContent,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.homeHeader}>
          <View>
            <Text style={[styles.eyebrow, { color: colors.tint }]}>مَجْلِس الشطرنج</Text>
            <Text style={[styles.homeTitle, { color: colors.foreground }]}>إلعب معي{'\n'}شطرنج</Text>
          </View>
          <Pressable
            accessibilityLabel="الإعدادات"
            testID="settings-button"
            onPress={() => setShowSettings((value) => !value)}
            style={({ pressed }) => [
              styles.iconButton,
              { backgroundColor: colors.card, borderColor: colors.border },
              pressed && styles.pressed,
            ]}
          >
            <Feather name="sliders" size={20} color={colors.foreground} />
          </Pressable>
        </View>

        <View style={[styles.heroCard, { backgroundColor: colors.primary }]}>
          <View style={styles.heroCopy}>
            <View style={[styles.livePill, { backgroundColor: 'rgba(225,181,108,0.18)' }]}>
              <View style={[styles.liveDot, { backgroundColor: colors.accent }]} />
              <Text style={[styles.liveText, { color: colors.accent }]}>جاهز للعب</Text>
            </View>
            <Text style={[styles.heroTitle, { color: colors.primaryForeground }]}>
              كل نقلة{'\n'}تصنع الحكاية
            </Text>
              <Text style={[styles.heroSubtitle, { color: colors.onPrimaryMuted }]}>
              مباراة هادئة، تركيز كامل، ومتعة تتجدد.
            </Text>
          </View>
          <View style={styles.heroArt} pointerEvents="none">
            <Text style={[styles.heroKnight, { color: colors.accent }]}>♞</Text>
            <View style={[styles.heroOrb, { backgroundColor: colors.boardDark }]} />
          </View>
        </View>

        {hasSavedGame ? (
          <Pressable
            testID="resume-game-button"
            onPress={() => onStart(savedMode, true, settings.aiDifficulty)}
            style={({ pressed }) => [
              styles.resumeCard,
              { backgroundColor: colors.card, borderColor: colors.border },
              pressed && styles.pressed,
            ]}
          >
            <View style={[styles.resumeIcon, { backgroundColor: colors.secondary }]}>
              <Feather name="bookmark" size={18} color={colors.primary} />
            </View>
            <View style={styles.resumeCopy}>
              <Text style={[styles.resumeTitle, { color: colors.foreground }]}>لديك مباراة محفوظة</Text>
              <Text style={[styles.resumeSubtitle, { color: colors.mutedForeground }]}>اضغط للعودة إلى الرقعة</Text>
            </View>
            <Feather name="chevron-left" size={20} color={colors.mutedForeground} />
          </Pressable>
        ) : null}

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>اختر طريقتك</Text>
        <Pressable
          testID="local-game-button"
           onPress={() => onStart('local', false, settings.aiDifficulty)}
          style={({ pressed }) => [
            styles.modeCard,
            { backgroundColor: colors.card, borderColor: colors.border },
            pressed && styles.pressed,
          ]}
        >
          <View style={[styles.modeIcon, { backgroundColor: colors.secondary }]}>
            <Feather name="users" size={22} color={colors.primary} />
          </View>
          <View style={styles.modeCopy}>
            <Text style={[styles.modeTitle, { color: colors.foreground }]}>لاعبان على نفس الجهاز</Text>
            <Text style={[styles.modeSubtitle, { color: colors.mutedForeground }]}>تناوبا على الدور واكتشفا أفضل نقلة</Text>
          </View>
          <Feather name="arrow-left" size={20} color={colors.primary} />
        </Pressable>

        <View style={[styles.computerModeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Pressable
            testID="computer-game-button"
            onPress={() => onStart('computer', false, settings.aiDifficulty)}
            style={({ pressed }) => [styles.computerModeHeader, pressed && styles.pressed]}
          >
            <View style={[styles.modeIcon, { backgroundColor: colors.secondary }]}>
              <Feather name="cpu" size={22} color={colors.primary} />
            </View>
            <View style={styles.modeCopy}>
              <Text style={[styles.modeTitle, { color: colors.foreground }]}>لاعب ضد الحاسوب</Text>
              <Text style={[styles.modeSubtitle, { color: colors.mutedForeground }]}>Stockfish جاهز لتحدٍ ذكي</Text>
            </View>
            <Feather name="arrow-left" size={20} color={colors.primary} />
          </Pressable>
          <View style={styles.difficultyHeading}>
            <Text style={[styles.difficultyLabel, { color: colors.mutedForeground }]}>اختر مستوى الحاسوب</Text>
            <Text style={[styles.difficultyValue, { color: colors.primary }]}>
              {DIFFICULTIES.find((item) => item.id === settings.aiDifficulty)?.label}
            </Text>
          </View>
          <View style={styles.difficultyRow}>
            {DIFFICULTIES.map((difficulty) => {
              const active = settings.aiDifficulty === difficulty.id;
              return (
                <Pressable
                  key={difficulty.id}
                  testID={`difficulty-${difficulty.id}`}
                  onPress={() => updateSettings({ aiDifficulty: difficulty.id })}
                  style={[
                    styles.difficultyOption,
                    {
                      backgroundColor: active ? colors.primary : colors.secondary,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.difficultyOptionText, { color: active ? colors.primaryForeground : colors.foreground }]}>
                    {difficulty.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.statsRow}>
          {[
            ['♟', 'لعب محلي', 'بدون إنترنت'],
            ['◷', 'تركيز كامل', 'بلا حدود زمنية'],
            ['↶', 'حرية اللعب', 'تراجع عن نقلة'],
          ].map(([icon, title, subtitle]) => (
            <View key={title} style={styles.statItem}>
              <Text style={[styles.statIcon, { color: colors.tint }]}>{icon}</Text>
              <Text style={[styles.statTitle, { color: colors.foreground }]}>{title}</Text>
              <Text style={[styles.statSubtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.progressCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.progressHeader}>
            <View>
              <Text style={[styles.progressTitle, { color: colors.foreground }]}>إحصائياتك</Text>
              <Text style={[styles.progressSubtitle, { color: colors.mutedForeground }]}>كل مباراة تقرّبك من نقلة أجمل</Text>
            </View>
            <Feather name="bar-chart-2" size={20} color={colors.tint} />
          </View>
          <View style={styles.progressStats}>
            <View style={styles.progressStat}>
              <Text style={[styles.progressNumber, { color: colors.foreground }]}>{stats.games}</Text>
              <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>مباريات</Text>
            </View>
            <View style={[styles.progressDivider, { backgroundColor: colors.border }]} />
            <View style={styles.progressStat}>
              <Text style={[styles.progressNumber, { color: colors.success }]}>{stats.wins}</Text>
              <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>انتصارات</Text>
            </View>
            <View style={[styles.progressDivider, { backgroundColor: colors.border }]} />
            <View style={styles.progressStat}>
              <Text style={[styles.progressNumber, { color: colors.tint }]}>{stats.draws}</Text>
              <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>تعادلات</Text>
            </View>
          </View>
        </View>

        {showSettings ? (
          <View style={[styles.settingsPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.settingsHeading}>
              <Text style={[styles.settingsTitle, { color: colors.foreground }]}>الإعدادات</Text>
              <Feather name="check-circle" size={18} color={colors.success} />
            </View>
            <SettingRow
              icon="clock"
              title="مؤقت المباراة"
              description={settings.timerEnabled ? `${settings.timerMinutes} دقائق لكل لاعب` : 'بدون وقت محدد'}
              value={settings.timerEnabled}
              onToggle={() => updateSettings({ timerEnabled: !settings.timerEnabled })}
            />
            {settings.timerEnabled ? (
              <View style={styles.durationRow}>
                {[5, 10, 15].map((minutes) => (
                  <Pressable
                    key={minutes}
                    testID={`timer-${minutes}-minutes`}
                    onPress={() => updateSettings({ timerMinutes: minutes })}
                    style={[
                      styles.durationOption,
                      {
                        backgroundColor: settings.timerMinutes === minutes ? colors.primary : colors.secondary,
                        borderColor: settings.timerMinutes === minutes ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.durationText, { color: settings.timerMinutes === minutes ? colors.primaryForeground : colors.foreground }]}>
                      {minutes} د
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <SettingRow
              icon="grid"
              title="إحداثيات الرقعة"
              description={settings.showCoordinates ? 'إظهار أسماء المربعات' : 'إخفاء أسماء المربعات'}
              value={settings.showCoordinates}
              onToggle={() => updateSettings({ showCoordinates: !settings.showCoordinates })}
            />
            <SettingRow
              icon="volume-2"
              title="أصوات اللعبة"
              description={settings.soundEnabled ? 'تشغيل صوت النقلات' : 'الأصوات متوقفة'}
              value={settings.soundEnabled}
              onToggle={() => updateSettings({ soundEnabled: !settings.soundEnabled })}
            />
          </View>
        ) : null}

        <Text style={[styles.footerNote, { color: colors.mutedForeground }]}>صُمّم للعب الهادئ والقرارات الذكية</Text>
      </ScrollView>
    </View>
  );
}

function GameScreen({
  onBack,
  initialMode,
  initialDifficulty,
  resume,
}: {
  onBack: () => void;
  initialMode: GameMode;
  initialDifficulty: DifficultyId;
  resume: boolean;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const boardWidth = Math.min(windowWidth - 76, 362);
  const [gameMode, setGameMode] = useState<GameMode>(initialMode);
  const [difficulty, setDifficulty] = useState<DifficultyId>(initialDifficulty);
  const [board, setBoard] = useState<Board>(() => createInitialBoard());
  const [turn, setTurn] = useState<Side>('white');
  const [selected, setSelected] = useState<Position | null>(null);
  const [history, setHistory] = useState<Move[]>([]);
  const [snapshots, setSnapshots] = useState<{
    board: Board;
    turn: Side;
    castlingRights: CastlingRights;
    enPassantTarget: Position | null;
    halfmoveClock: number;
    positionKeys: string[];
  }[]>([]);
  const [castlingRights, setCastlingRights] = useState<CastlingRights>(() => copyCastlingRights(INITIAL_CASTLING_RIGHTS));
  const [enPassantTarget, setEnPassantTarget] = useState<Position | null>(null);
  const [halfmoveClock, setHalfmoveClock] = useState(0);
  const [positionKeys, setPositionKeys] = useState<string[]>([
    positionKey(createInitialBoard(), 'white', INITIAL_CASTLING_RIGHTS, null),
  ]);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: Position; to: Position } | null>(null);
  const [lastMove, setLastMove] = useState<Move | null>(null);
  const [hint, setHint] = useState<{ from: Position; to: Position } | null>(null);
  const [status, setStatus] = useState<GameStatus>('playing');
  const [showMoves, setShowMoves] = useState(false);
  const [boardFlipped, setBoardFlipped] = useState(false);
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_SETTINGS);
  const [clocks, setClocks] = useState<Record<Side, number>>({
    white: DEFAULT_SETTINGS.timerMinutes * 60,
    black: DEFAULT_SETTINGS.timerMinutes * 60,
  });
  const [engineReady, setEngineReady] = useState(initialMode === 'local');
  const [engineFailed, setEngineFailed] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isAdLoading, setIsAdLoading] = useState<'hint' | 'undo' | null>(null);
  const [completedGames, setCompletedGames] = useState(0);
  const resultSaved = useRef(false);
  const hydrated = useRef(!resume);
  const engineRef = useRef<StockfishEngine | null>(null);
  const pendingEngineMove = useRef(false);
  const computerFallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitMoveRef = useRef<((from: Position, to: Position, promotion?: PromotionKind) => void) | null>(null);
  const boardRef = useRef(board);
  const turnRef = useRef(turn);
  const statusRef = useRef(status);
  const castlingRightsRef = useRef(castlingRights);
  const enPassantTargetRef = useRef(enPassantTarget);

  boardRef.current = board;
  turnRef.current = turn;
  statusRef.current = status;
  castlingRightsRef.current = castlingRights;
  enPassantTargetRef.current = enPassantTarget;

  const clearComputerFallbackTimer = () => {
    if (computerFallbackTimer.current) {
      clearTimeout(computerFallbackTimer.current);
      computerFallbackTimer.current = null;
    }
  };

  const playLocalComputerMove = () => {
    if (!pendingEngineMove.current) return;
    const currentBoard = boardRef.current;
    const currentTurn = turnRef.current;
    const currentStatus = statusRef.current;
    const fallback = currentTurn === 'black' && currentStatus === 'playing'
      ? chooseComputerMove(currentBoard, castlingRightsRef.current, enPassantTargetRef.current)
      : null;
    clearComputerFallbackTimer();
    pendingEngineMove.current = false;
    setIsThinking(false);
    if (fallback) commitMoveRef.current?.(fallback.from, fallback.to);
  };

  useEffect(() => {
    Promise.all([resume ? AsyncStorage.getItem(STORAGE_KEY) : Promise.resolve(null), AsyncStorage.getItem(SETTINGS_KEY)]).then(
      ([saved, savedSettings]) => {
        if (savedSettings) {
          try {
            const parsedSettings = { ...DEFAULT_SETTINGS, ...(JSON.parse(savedSettings) as Partial<GameSettings>) };
            setSettings(parsedSettings);
            if (!resume) setDifficulty(parsedSettings.aiDifficulty);
            setClocks({
              white: parsedSettings.timerMinutes * 60,
              black: parsedSettings.timerMinutes * 60,
            });
          } catch {
            setSettings(DEFAULT_SETTINGS);
          }
        }
        if (saved) {
          try {
            const parsed = JSON.parse(saved) as {
              board: Board;
              turn: Side;
              history: Move[];
              snapshots?: {
                board: Board;
                turn: Side;
                castlingRights?: CastlingRights;
                enPassantTarget?: Position | null;
                halfmoveClock?: number;
                positionKeys?: string[];
              }[];
              lastMove: Move | null;
              clocks?: Record<Side, number>;
              status?: GameStatus;
              mode?: GameMode;
              difficulty?: DifficultyId;
              castlingRights?: CastlingRights;
              enPassantTarget?: Position | null;
              halfmoveClock?: number;
              positionKeys?: string[];
            };
            if (parsed.board && parsed.turn) {
              const parsedHistory = parsed.history ?? [];
              const savedCastlingRights = parsed.castlingRights ?? deriveCastlingRights(parsedHistory);
              if (parsed.mode === 'computer' || parsed.mode === 'local') setGameMode(parsed.mode);
              if (parsed.difficulty && DIFFICULTIES.some((item) => item.id === parsed.difficulty)) {
                setDifficulty(parsed.difficulty);
              }
              setBoard(parsed.board);
              setTurn(parsed.turn);
              setHistory(parsedHistory);
              setSnapshots(
                (parsed.snapshots ?? []).map((snapshot, index) => {
                  const snapshotHistory = parsedHistory.slice(0, index);
                  return {
                    board: copyBoard(snapshot.board),
                    turn: snapshot.turn,
                    castlingRights: copyCastlingRights(
                      snapshot.castlingRights ?? deriveCastlingRights(snapshotHistory),
                    ),
                    enPassantTarget: snapshot.enPassantTarget ?? null,
                    halfmoveClock: snapshot.halfmoveClock ?? 0,
                    positionKeys: snapshot.positionKeys ?? [
                      positionKey(
                        snapshot.board,
                        snapshot.turn,
                        snapshot.castlingRights ?? INITIAL_CASTLING_RIGHTS,
                        snapshot.enPassantTarget ?? null,
                      ),
                    ],
                  };
                }),
              );
              setCastlingRights(copyCastlingRights(savedCastlingRights));
              setEnPassantTarget(parsed.enPassantTarget ?? null);
              setHalfmoveClock(parsed.halfmoveClock ?? 0);
              setPositionKeys(
                parsed.positionKeys
                  ?? [positionKey(parsed.board, parsed.turn, savedCastlingRights, parsed.enPassantTarget ?? null)],
              );
              setLastMove(parsed.lastMove ?? null);
              if (parsed.clocks) setClocks(parsed.clocks);
              if (parsed.status && parsed.status !== 'playing') {
                setStatus(parsed.status);
                resultSaved.current = true;
              }
            }
          } catch {
            void AsyncStorage.removeItem(STORAGE_KEY);
          }
        }
        hydrated.current = true;
      },
    );
  }, [resume]);

  useEffect(() => {
    if (!hydrated.current) return;
    void AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        board,
        turn,
        history,
        snapshots,
        castlingRights,
        enPassantTarget,
        halfmoveClock,
        positionKeys,
        lastMove,
        clocks,
        status,
        mode: gameMode,
        difficulty,
      }),
    );
  }, [
    board,
    turn,
    history,
    snapshots,
    castlingRights,
    enPassantTarget,
    halfmoveClock,
    positionKeys,
    lastMove,
    clocks,
    status,
    gameMode,
    difficulty,
  ]);

  useEffect(() => {
    if (gameMode !== 'computer') {
      setEngineReady(true);
      setEngineFailed(false);
      setIsThinking(false);
      return undefined;
    }

    let cancelled = false;
    setEngineReady(false);
    setEngineFailed(false);
    const handleEngineLine = (line: string) => {
      if (cancelled) return;
      const normalizedLine = line.trim();
      if (normalizedLine === 'readyok') {
        setEngineReady(true);
        return;
      }
      if (!pendingEngineMove.current || !normalizedLine.startsWith('bestmove ')) return;
      const parsed = parseUciMove(normalizedLine.slice('bestmove '.length).split(' ')[0]);
      if (!parsed) {
        playLocalComputerMove();
        return;
      }
      const currentBoard = boardRef.current;
      const currentTurn = turnRef.current;
      const currentStatus = statusRef.current;
      const isLegal = currentTurn === 'black'
        && currentStatus === 'playing'
        && Boolean(currentBoard[parsed.from.row][parsed.from.col]?.side === 'black')
        && legalMoves(
          currentBoard,
          parsed.from,
          castlingRightsRef.current,
          enPassantTargetRef.current,
        ).some((move) => samePosition(move, parsed.to));
      if (isLegal) {
        clearComputerFallbackTimer();
        pendingEngineMove.current = false;
        setIsThinking(false);
        commitMoveRef.current?.(parsed.from, parsed.to, parsed.promotion);
      } else {
        playLocalComputerMove();
      }
    };

    createStockfishEngine(handleEngineLine).then((engine) => {
      if (cancelled) {
        engine.terminate?.();
        return;
      }
      engineRef.current = engine;
      engine.processCommand('uci');
      engine.processCommand('isready');
    }).catch(() => {
      if (!cancelled) {
        setEngineFailed(true);
        setEngineReady(true);
      }
    });

    return () => {
      cancelled = true;
      clearComputerFallbackTimer();
      pendingEngineMove.current = false;
      engineRef.current?.terminate?.();
      engineRef.current = null;
    };
  }, [gameMode]);

  useEffect(() => {
    if (!settings.timerEnabled || status !== 'playing') return undefined;
    let lastTickAt = Date.now();
    let appState = AppState.currentState;
    const tick = () => {
      if (appState !== 'active') return;
      const elapsed = Math.floor((Date.now() - lastTickAt) / 1000);
      if (elapsed <= 0) return;
      lastTickAt += elapsed * 1000;
      setClocks((current) => {
        const nextValue = Math.max(0, current[turn] - elapsed);
        if (nextValue === 0) {
          setStatus('timeout');
          setSelected(null);
        }
        return { ...current, [turn]: nextValue };
      });
    };
    const interval = setInterval(tick, 250);
    const subscription = AppState.addEventListener('change', (nextState) => {
      appState = nextState;
      if (nextState === 'active') tick();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [settings.timerEnabled, status, turn]);

  useEffect(() => {
    if (status === 'playing' || resultSaved.current) return;
    resultSaved.current = true;
    AsyncStorage.getItem(STATS_KEY).then((saved) => {
      let currentStats = DEFAULT_STATS;
      if (saved) {
        try {
          currentStats = { ...DEFAULT_STATS, ...(JSON.parse(saved) as Partial<GameStats>) };
        } catch {
          currentStats = DEFAULT_STATS;
        }
      }
      const nextStats: GameStats = {
        games: currentStats.games + 1,
        wins: currentStats.wins + (['checkmate', 'timeout'].includes(status) && otherSide(turn) === 'white' ? 1 : 0),
        losses: currentStats.losses + (['checkmate', 'timeout'].includes(status) && otherSide(turn) === 'black' ? 1 : 0),
        draws: currentStats.draws + (!['checkmate', 'timeout', 'resigned'].includes(status) ? 1 : 0),
      };
      void AsyncStorage.setItem(STATS_KEY, JSON.stringify(nextStats));
      setCompletedGames(nextStats.games);
      if (shouldShowInterstitial(nextStats.games)) {
        Alert.alert('إعلان تجريبي', 'ستظهر هنا شاشة إعلان بيني كل 3 مباريات في نسخة الإعلانات الفعلية.');
      }
    });
  }, [status]);

  const selectedMoves = useMemo(
    () => (selected ? legalMoves(board, selected, castlingRights, enPassantTarget) : []),
    [board, selected, castlingRights, enPassantTarget],
  );
  const legalTurnMoves = useMemo(
    () => allLegalMoves(board, turn, castlingRights, enPassantTarget),
    [board, turn, castlingRights, enPassantTarget],
  );
  const inCheck = isInCheck(board, turn);

  const playMove = (from: Position, to: Position, promotion: PromotionKind = 'queen') => {
    const currentBoard = boardRef.current;
    const currentTurn = turnRef.current;
    const piece = currentBoard[from.row][from.col];
    if (!piece || piece.side !== currentTurn) return;
    const currentCastlingRights = castlingRightsRef.current;
    const currentEnPassantTarget = enPassantTargetRef.current;
    const isEnPassant = piece.kind === 'pawn'
      && currentEnPassantTarget
      && samePosition(to, currentEnPassantTarget)
      && !currentBoard[to.row][to.col];
    const captured = isEnPassant
      ? currentBoard[to.row - (piece.side === 'white' ? -1 : 1)][to.col]
      : currentBoard[to.row][to.col];
    const isCastle = piece.kind === 'king' && Math.abs(to.col - from.col) === 2;
    const move: Move = {
      from,
      to,
      piece,
      captured,
      special: isCastle ? 'castle' : isEnPassant ? 'enPassant' : 'normal',
      ...(piece.kind === 'pawn' && (to.row === 0 || to.row === 7) ? { promotion } : {}),
    };
    const nextBoard = applyMove(currentBoard, from, to, promotion, currentEnPassantTarget);
    const nextCastlingRights = updateCastlingRights(currentCastlingRights, piece, from, to, captured);
    const nextEnPassantTarget = piece.kind === 'pawn' && Math.abs(to.row - from.row) === 2
      ? { row: (to.row + from.row) / 2, col: from.col }
      : null;
    const nextTurn = otherSide(currentTurn);
    const nextMoves = allLegalMoves(nextBoard, nextTurn, nextCastlingRights, nextEnPassantTarget);
    const nextHalfmoveClock = piece.kind === 'pawn' || captured ? 0 : halfmoveClock + 1;
    const nextPositionKey = positionKey(nextBoard, nextTurn, nextCastlingRights, nextEnPassantTarget);
    const nextPositionKeys = [...positionKeys, nextPositionKey];
    const san = formatSan(move, currentBoard, currentCastlingRights, currentEnPassantTarget, nextBoard, nextTurn, nextMoves);
    const committedMove = { ...move, san };
    let nextStatus: GameStatus = 'playing';
    if (nextMoves.length === 0) {
      nextStatus = isInCheck(nextBoard, nextTurn) ? 'checkmate' : 'stalemate';
    } else if (isInsufficientMaterial(nextBoard)) {
      nextStatus = 'drawInsufficientMaterial';
    } else if (nextHalfmoveClock >= 100) {
      nextStatus = 'drawFiftyMove';
    } else if (countOccurrences(nextPositionKeys, nextPositionKey) >= 3) {
      nextStatus = 'drawThreefold';
    }
    setSnapshots((items) => [
      ...items,
      {
        board: copyBoard(currentBoard),
        turn: currentTurn,
        castlingRights: copyCastlingRights(currentCastlingRights),
        enPassantTarget: currentEnPassantTarget,
        halfmoveClock,
        positionKeys: [...positionKeys],
      },
    ]);
    setBoard(nextBoard);
    setCastlingRights(nextCastlingRights);
    setEnPassantTarget(nextEnPassantTarget);
    setHalfmoveClock(nextHalfmoveClock);
    setPositionKeys(nextPositionKeys);
    setHistory((items) => [...items, committedMove]);
    setLastMove(committedMove);
    setSelected(null);
    setHint(null);
    setTurn(nextTurn);
    setStatus(nextStatus);
    setPendingPromotion(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    playSound(
      ['checkmate', 'stalemate', 'drawInsufficientMaterial', 'drawThreefold', 'drawFiftyMove'].includes(nextStatus)
        ? 'gameOver'
        : isInCheck(nextBoard, nextTurn)
          ? 'check'
          : captured
            ? 'capture'
            : 'move',
      settings.soundEnabled,
    );
  };
  commitMoveRef.current = playMove;

  useEffect(() => {
    if (
      gameMode !== 'computer'
      || turn !== 'black'
      || status !== 'playing'
      || isThinking
      || (!engineReady && !engineFailed)
    ) {
      return;
    }
    const selectedDifficulty = DIFFICULTIES.find((item) => item.id === difficulty) ?? DIFFICULTIES[2];
    pendingEngineMove.current = true;
    setIsThinking(true);
    clearComputerFallbackTimer();
    if (engineFailed || !engineRef.current) {
      computerFallbackTimer.current = setTimeout(playLocalComputerMove, 250);
      return;
    }
    computerFallbackTimer.current = setTimeout(playLocalComputerMove, 5000);
    engineRef.current.processCommand('ucinewgame');
    engineRef.current.processCommand(`setoption name Skill Level value ${selectedDifficulty.skill}`);
    const moveList = history.map(moveToUci).join(' ');
    engineRef.current.processCommand(`position startpos moves ${moveList}`.trim());
    engineRef.current.processCommand(`go depth ${selectedDifficulty.depth}`);
  }, [board, turn, status, engineReady, engineFailed, isThinking, gameMode, difficulty, history.length]);

  const handleSquarePress = (position: Position) => {
    if (
      status !== 'playing'
      || isThinking
      || pendingPromotion
      || (gameMode === 'computer' && turn !== 'white')
    ) return;
    const piece = board[position.row][position.col];
    if (selected && selectedMoves.some((move) => samePosition(move, position))) {
      const selectedPiece = board[selected.row][selected.col];
      if (selectedPiece?.kind === 'pawn' && (position.row === 0 || position.row === 7)) {
        setPendingPromotion({ from: selected, to: position });
      } else {
        playMove(selected, position);
      }
      return;
    }
    if (piece?.side === turn) {
      setSelected(position);
      setHint(null);
    } else {
      setSelected(null);
    }
  };

  const undo = () => {
    if (isThinking || status !== 'playing') return;
    const steps = gameMode === 'computer' ? Math.min(2, snapshots.length) : 1;
    const previous = snapshots[snapshots.length - steps];
    if (!previous) return;
    setBoard(previous.board);
    setTurn(previous.turn);
    setCastlingRights(copyCastlingRights(previous.castlingRights));
    setEnPassantTarget(previous.enPassantTarget);
    setHalfmoveClock(previous.halfmoveClock);
    setPositionKeys(previous.positionKeys);
    setSnapshots((items) => items.slice(0, -steps));
    const nextHistory = history.slice(0, -steps);
    setHistory(nextHistory);
    setLastMove(nextHistory.length > 0 ? nextHistory[nextHistory.length - 1] : null);
    setStatus('playing');
    setSelected(null);
    setPendingPromotion(null);
  };

  const requestUndo = () => {
    if (!snapshots.length || isThinking || status !== 'playing' || isAdLoading) return;
    setIsAdLoading('undo');
    void showRewardedAd('undo').then((watched) => {
      setIsAdLoading(null);
      if (watched) undo();
    });
  };

  const resign = () => {
    if (status !== 'playing') return;
    Alert.alert('استسلام', 'هل تريد إنهاء المباراة بالاستسلام؟', [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'استسلام', style: 'destructive', onPress: () => setStatus('resigned') },
    ]);
  };

  const offerDraw = () => {
    if (status !== 'playing') return;
    Alert.alert('طلب التعادل', 'هل توافقان على إنهاء المباراة بالتعادل؟', [
      { text: 'متابعة اللعب', style: 'cancel' },
      { text: 'تعادل', onPress: () => setStatus('agreedDraw') },
    ]);
  };

  const newGame = () => {
    Alert.alert('مباراة جديدة', 'هل تريد بدء مباراة جديدة؟', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'ابدأ',
        onPress: () => {
          clearComputerFallbackTimer();
          pendingEngineMove.current = false;
          engineRef.current?.processCommand('stop');
          setBoard(createInitialBoard());
          setTurn('white');
          setCastlingRights(copyCastlingRights(INITIAL_CASTLING_RIGHTS));
          setEnPassantTarget(null);
          setHalfmoveClock(0);
          setPositionKeys([positionKey(createInitialBoard(), 'white', INITIAL_CASTLING_RIGHTS, null)]);
          setSelected(null);
          setHistory([]);
          setSnapshots([]);
          setLastMove(null);
          setHint(null);
          setPendingPromotion(null);
          setStatus('playing');
          setClocks({
            white: settings.timerMinutes * 60,
            black: settings.timerMinutes * 60,
          });
          resultSaved.current = false;
        },
      },
    ]);
  };

  const showHint = () => {
    if (!legalTurnMoves[0] || isAdLoading) return;
    setIsAdLoading('hint');
    void showRewardedAd('hint').then((watched) => {
      setIsAdLoading(null);
      if (!watched) return;
      const firstMove = legalTurnMoves[0];
      if (!firstMove) return;
      setHint(firstMove);
      setSelected(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    });
  };

  const capturedPieces = history
    .map((move) => move.captured)
    .filter((piece): piece is Piece => Boolean(piece));
  const material = capturedPieces.reduce((total, piece) => total + PIECE_VALUES[piece.kind], 0);
  const turnLabel = turn === 'white' ? 'الأبيض' : 'الأسود';
  const difficultyLabel = DIFFICULTIES.find((item) => item.id === difficulty)?.label ?? 'متوسط';
  const turnDisplayLabel = gameMode === 'computer' && isThinking ? 'الحاسوب يفكر...' : turnLabel;

  return (
    <View style={[styles.page, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.gameContent,
          { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 18 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.gameHeader}>
          <Pressable
            testID="back-button"
            accessibilityLabel="العودة"
            onPress={onBack}
            style={({ pressed }) => [
              styles.iconButton,
              { backgroundColor: colors.card, borderColor: colors.border },
              pressed && styles.pressed,
            ]}
          >
            <Feather name="chevron-right" size={21} color={colors.foreground} />
          </Pressable>
          <View style={styles.gameHeaderCenter}>
            <Text style={[styles.eyebrow, { color: colors.tint }]}>
              {gameMode === 'computer' ? `ضد الحاسوب · ${difficultyLabel}` : 'مباراة محلية'}
            </Text>
            <Text style={[styles.gameTitle, { color: colors.foreground }]}>الرقعة بين يديك</Text>
          </View>
          <View style={styles.gameHeaderActions}>
            <Pressable
              testID="flip-board-button"
              accessibilityLabel="تدوير اتجاه الرقعة"
              onPress={() => setBoardFlipped((value) => !value)}
              style={({ pressed }) => [
                styles.iconButton,
                { backgroundColor: colors.card, borderColor: colors.border },
                pressed && styles.pressed,
              ]}
            >
              <Feather name="refresh-cw" size={18} color={colors.foreground} />
            </Pressable>
            <Pressable
              testID="new-game-icon-button"
              accessibilityLabel="مباراة جديدة"
              onPress={newGame}
              style={({ pressed }) => [
                styles.iconButton,
                { backgroundColor: colors.card, borderColor: colors.border },
                pressed && styles.pressed,
              ]}
            >
              <Feather name="rotate-ccw" size={19} color={colors.foreground} />
            </Pressable>
          </View>
        </View>
        {gameMode === 'computer' ? (
          <View style={[styles.playerNotice, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
            <Feather name="user" size={14} color={colors.primary} />
            <Text style={[styles.playerNoticeText, { color: colors.foreground }]}>أنت تلعب بالأبيض · الحاسوب بالأسود</Text>
          </View>
        ) : null}

        <View style={styles.clocksRow}>
          {(['black', 'white'] as Side[]).map((side) => {
            const active = turn === side && status === 'playing';
            return (
              <View
                key={side}
                style={[
                  styles.clockCard,
                  {
                    backgroundColor: active ? colors.primary : colors.card,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <View style={styles.clockIdentity}>
                  <View style={[styles.clockDot, { backgroundColor: side === 'white' ? colors.boardLight : colors.primary }]} />
                  <Text style={[styles.clockName, { color: active ? colors.primaryForeground : colors.foreground }]}>
                    {side === 'white' ? 'الأبيض' : 'الأسود'}
                  </Text>
                </View>
                <Text style={[styles.clockValue, { color: active ? colors.primaryForeground : colors.foreground }]}>
                  {settings.timerEnabled ? formatClock(clocks[side]) : '∞'}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={[styles.turnCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.turnMark, { backgroundColor: turn === 'white' ? colors.boardLight : colors.primary }]}>
            <Text style={[styles.turnPiece, { color: turn === 'white' ? colors.primary : colors.primaryForeground }]}>
              {turn === 'white' ? '♔' : '♚'}
            </Text>
          </View>
          <View style={styles.turnCopy}>
            <Text style={[styles.turnLabel, { color: colors.mutedForeground }]}>الدور الآن</Text>
            <Text style={[styles.turnName, { color: colors.foreground }]}>{turnDisplayLabel}</Text>
          </View>
          <View style={styles.turnStatus}>
            {inCheck ? <Text style={[styles.checkText, { color: colors.destructive }]}>كش</Text> : null}
            {isThinking ? <Feather name="loader" size={16} color={colors.tint} /> : null}
            <View style={[styles.turnDot, { backgroundColor: inCheck ? colors.destructive : colors.success }]} />
          </View>
        </View>

        {gameMode === 'computer' && !engineReady && !engineFailed ? (
          <View style={[styles.engineStatus, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
            <Feather name="cpu" size={16} color={colors.primary} />
            <Text style={[styles.engineStatusText, { color: colors.foreground }]}>يتم تجهيز Stockfish...</Text>
          </View>
        ) : null}
        {gameMode === 'computer' && engineFailed ? (
          <View style={[styles.engineStatus, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
            <Feather name="cpu" size={16} color={colors.primary} />
            <Text style={[styles.engineStatusText, { color: colors.foreground }]}>وضع الحاسوب الاحتياطي يعمل</Text>
          </View>
        ) : null}

        <View style={styles.boardShell}>
          <View style={[styles.boardFrame, { backgroundColor: colors.primary }]}>
            <View style={styles.rankLabels}>
              {settings.showCoordinates && (boardFlipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1]).map((rank) => (
                <Text key={rank} style={[styles.coordinate, { color: colors.boardLight }]}>{rank}</Text>
              ))}
            </View>
            <View style={[styles.board, { width: boardWidth, height: boardWidth }]} testID="chess-board">
              {(boardFlipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7]).map((rowIndex) =>
                (boardFlipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7]).map((colIndex) => {
                  const piece = board[rowIndex][colIndex];
                  const position = { row: rowIndex, col: colIndex };
                  const isDark = (rowIndex + colIndex) % 2 === 1;
                  const isSelected = selected ? samePosition(selected, position) : false;
                  const isLegalTarget = selectedMoves.some((move) => samePosition(move, position));
                  const isLast = lastMove
                    ? samePosition(lastMove.from, position) || samePosition(lastMove.to, position)
                    : false;
                  const isHint = hint
                    ? samePosition(hint.from, position) || samePosition(hint.to, position)
                    : false;
                  return (
                    <Pressable
                      key={`${rowIndex}-${colIndex}`}
                      testID={`square-${rowIndex}-${colIndex}`}
                      accessibilityLabel={`${piece ? PIECES[piece.side][piece.kind] : 'مربع فارغ'} ${squareToUci(position)}`}
                      disabled={isThinking || (gameMode === 'computer' && turn !== 'white') || status !== 'playing'}
                      onPress={() => handleSquarePress(position)}
                      style={[
                        styles.square,
                        { backgroundColor: isDark ? colors.boardDark : colors.boardLight },
                        isLast && { backgroundColor: colors.boardLastMove },
                        isHint && { backgroundColor: colors.boardHighlight },
                        isSelected && { backgroundColor: colors.boardHighlight },
                      ]}
                    >
                      {piece ? (
                        <Text
                          style={[
                            styles.piece,
                            piece.side === 'white'
                              ? { color: colors.pieceWhite, textShadowColor: colors.primary }
                              : { color: colors.pieceBlack, textShadowColor: colors.boardLight },
                          ]}
                        >
                          {PIECES[piece.side][piece.kind]}
                        </Text>
                      ) : null}
                      {isLegalTarget ? (
                        <View
                          style={[
                            styles.moveMarker,
                            piece ? styles.captureMarker : null,
                            { backgroundColor: piece ? colors.destructive : colors.primary },
                          ]}
                        />
                      ) : null}
                    </Pressable>
                  );
                }),
              )}
            </View>
            <View style={styles.fileLabels}>
              {settings.showCoordinates && (boardFlipped ? [...FILES].reverse() : FILES).map((file) => (
                <Text key={file} style={[styles.coordinate, { color: colors.boardLight }]}>{file}</Text>
              ))}
            </View>
          </View>
        </View>

        {pendingPromotion ? (
          <View style={[styles.promotionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.promotionCopy}>
              <Text style={[styles.promotionTitle, { color: colors.foreground }]}>اختر قطعة الترقية</Text>
              <Text style={[styles.promotionSubtitle, { color: colors.mutedForeground }]}>حوّل البيدق إلى قطعة أقوى</Text>
            </View>
            <View style={styles.promotionOptions}>
              {(['queen', 'rook', 'bishop', 'knight'] as PromotionKind[]).map((kind) => (
                <Pressable
                  key={kind}
                  testID={`promotion-${kind}`}
                  onPress={() => {
                    playMove(pendingPromotion.from, pendingPromotion.to, kind);
                  }}
                  style={({ pressed }) => [
                    styles.promotionOption,
                    { backgroundColor: colors.secondary, borderColor: colors.border },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.promotionPiece, { color: colors.primary }]}>
                    {PIECES[turn][kind]}
                  </Text>
                  <Text style={[styles.promotionLabel, { color: colors.foreground }]}>
                    {kind === 'queen' ? 'وزير' : kind === 'rook' ? 'قلعة' : kind === 'bishop' ? 'فيل' : 'حصان'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.gameActions}>
          <Button
            testID="hint-button"
            variant="secondary"
            icon="sun"
            onPress={showHint}
            disabled={isThinking || (gameMode === 'computer' && turn !== 'white') || status !== 'playing'}
          >
            {isAdLoading === 'hint' ? 'جاري التحميل...' : 'تلميحة'}
          </Button>
          <Button
            testID="undo-button"
            variant="secondary"
            icon="corner-up-left"
            onPress={requestUndo}
            disabled={history.length === 0 || isThinking || status !== 'playing'}
          >
            {isAdLoading === 'undo' ? 'جاري التحميل...' : 'تراجع'}
          </Button>
          <Button
            testID="new-game-button"
            variant="primary"
            icon="plus"
            onPress={newGame}
          >
            مباراة جديدة
          </Button>
        </View>
        <View style={styles.secondaryActions}>
          <Button variant="ghost" icon="flag" onPress={resign} disabled={status !== 'playing'}>استسلام</Button>
          <Button variant="ghost" icon="message-circle" onPress={offerDraw} disabled={status !== 'playing'}>طلب التعادل</Button>
        </View>
        <View style={[styles.adBanner, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
          <Feather name="info" size={13} color={colors.mutedForeground} />
          <Text style={[styles.adBannerText, { color: colors.mutedForeground }]}>
            {AD_MODE === 'placeholder' ? 'مساحة إعلان تجريبية — سيتم ربط مزود الإعلانات لاحقًا' : 'إعلان'}
          </Text>
        </View>

        {status !== 'playing' ? (
          <View style={[styles.resultCard, { backgroundColor: colors.primary }]}>
            <Feather name={status === 'checkmate' || status === 'timeout' ? 'award' : 'minus-circle'} size={22} color={colors.accent} />
            <View style={styles.resultCopy}>
              <Text style={[styles.resultTitle, { color: colors.primaryForeground }]}>
                {status === 'checkmate'
                  ? `كش مات — ${otherSide(turn) === 'white' ? 'الأبيض' : 'الأسود'} يفوز`
                  : status === 'timeout'
                    ? `انتهى الوقت — ${otherSide(turn) === 'white' ? 'الأبيض' : 'الأسود'} يفوز`
                    : status === 'resigned'
                      ? `استسلام — ${otherSide(turn) === 'white' ? 'الأبيض' : 'الأسود'} يفوز`
                      : status === 'drawInsufficientMaterial'
                        ? 'تعادل — قطع غير كافية'
                        : status === 'drawThreefold'
                          ? 'تعادل — تكرار الوضع ثلاث مرات'
                          : status === 'drawFiftyMove'
                            ? 'تعادل — قاعدة الخمسين نقلة'
                            : status === 'agreedDraw'
                              ? 'تعادل بالاتفاق'
                              : 'تعادل'}
              </Text>
              <Text style={[styles.resultText, { color: colors.onPrimaryMuted }]}>
                {['checkmate', 'timeout', 'resigned'].includes(status)
                  ? 'أحسنتما. كانت مباراة تستحق أن تُحفظ.'
                  : status === 'stalemate' ? 'لا توجد نقلات قانونية متبقية.' : 'تحققت إحدى قواعد التعادل.'}
              </Text>
            </View>
          </View>
        ) : null}

        <Pressable
          testID="moves-toggle"
          onPress={() => setShowMoves((value) => !value)}
          style={({ pressed }) => [styles.movesHeading, pressed && styles.pressed]}
        >
          <View style={styles.movesHeadingText}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>سجل النقلات</Text>
            <View style={[styles.countBadge, { backgroundColor: colors.secondary }]}>
              <Text style={[styles.countText, { color: colors.primary }]}>{history.length}</Text>
            </View>
          </View>
          <Feather name={showMoves ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedForeground} />
        </Pressable>
        {showMoves ? (
          <View style={[styles.movesList, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {history.length === 0 ? (
              <Text style={[styles.emptyMoves, { color: colors.mutedForeground }]}>لم تبدأ أي نقلة بعد</Text>
            ) : (
              history.slice(-6).reverse().map((move, index) => (
                <View key={`${formatMove(move)}-${index}`} style={styles.moveRow}>
                  <Text style={[styles.moveNumber, { color: colors.mutedForeground }]}>{history.length - index}</Text>
                  <Text style={[styles.moveText, { color: colors.foreground }]}>{formatMove(move)}</Text>
                  {move.captured ? <Feather name="x" size={13} color={colors.destructive} /> : null}
                </View>
              ))
            )}
          </View>
        ) : null}
        <Text style={[styles.materialNote, { color: colors.mutedForeground }]}>
          {material > 0 ? `قيمة القطع المأخوذة: ${material}` : 'اختر قطعة من لون الدور لبدء اللعب'}
        </Text>
      </ScrollView>
    </View>
  );
}

export default function HomeRoute() {
  const [screen, setScreen] = useState<'home' | 'game'>('home');
  const [gameLaunch, setGameLaunch] = useState<{
    mode: GameMode;
    difficulty: DifficultyId;
    resume: boolean;
  }>({
    mode: 'local',
    difficulty: DEFAULT_SETTINGS.aiDifficulty,
    resume: false,
  });

  const startGame = (mode: GameMode, resume = false, difficulty = DEFAULT_SETTINGS.aiDifficulty) => {
    setGameLaunch((current) => ({ ...current, mode, resume, difficulty }));
    setScreen('game');
  };

  return screen === 'home' ? (
    <HomeScreen onStart={startGame} />
  ) : (
    <GameScreen
      onBack={() => setScreen('home')}
      initialMode={gameLaunch.mode}
      initialDifficulty={gameLaunch.difficulty}
      resume={gameLaunch.resume}
    />
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  homeContent: { paddingHorizontal: 20, gap: 18 },
  homeHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  eyebrow: { fontSize: 12, letterSpacing: 1.2, fontWeight: '700' },
  homeTitle: { fontSize: 38, lineHeight: 43, fontWeight: '700', marginTop: 6 },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 14,
  },
  heroCard: {
    minHeight: 218,
    borderRadius: 26,
    padding: 24,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  heroCopy: { flex: 1, zIndex: 2 },
  livePill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, gap: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 7 },
  liveText: { fontSize: 12, fontWeight: '700' },
  heroTitle: { fontSize: 30, lineHeight: 35, fontWeight: '700', marginTop: 20 },
  heroSubtitle: { fontSize: 13, lineHeight: 19, marginTop: 13, maxWidth: 190 },
  heroArt: { width: 92, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  heroKnight: { fontSize: 115, lineHeight: 130, zIndex: 2, transform: [{ translateY: 5 }] },
  heroOrb: { width: 116, height: 116, borderRadius: 100, position: 'absolute', right: -15, bottom: 2, opacity: 0.55 },
  resumeCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 18, borderWidth: 1, padding: 14, gap: 12 },
  resumeIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  resumeCopy: { flex: 1 },
  resumeTitle: { fontSize: 14, fontWeight: '700' },
  resumeSubtitle: { fontSize: 12, marginTop: 3 },
  sectionLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 0.3 },
  modeCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 19, borderWidth: 1, padding: 15, gap: 13 },
  computerModeCard: { borderRadius: 19, borderWidth: 1, padding: 15, gap: 12 },
  computerModeHeader: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  modeIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  modeCopy: { flex: 1 },
  modeTitle: { fontSize: 15, fontWeight: '700' },
  modeSubtitle: { fontSize: 11, marginTop: 5 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 4 },
  statItem: { width: '31%', alignItems: 'center', gap: 4 },
  statIcon: { fontSize: 22, lineHeight: 27 },
  statTitle: { fontSize: 11, fontWeight: '700' },
  statSubtitle: { fontSize: 9, textAlign: 'center' },
  progressCard: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 15 },
  progressHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressTitle: { fontSize: 15, fontWeight: '700' },
  progressSubtitle: { fontSize: 11, marginTop: 4 },
  progressStats: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  progressStat: { alignItems: 'center', gap: 3 },
  progressNumber: { fontSize: 24, fontWeight: '700' },
  progressLabel: { fontSize: 10 },
  progressDivider: { width: 1, height: 29 },
  settingsPanel: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 9 },
  settingsHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  settingsTitle: { fontSize: 15, fontWeight: '700' },
  settingsText: { fontSize: 12, lineHeight: 19 },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  settingIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  settingCopy: { flex: 1 },
  settingTitle: { fontSize: 12, fontWeight: '700' },
  settingDescription: { fontSize: 10, marginTop: 3 },
  toggle: { width: 42, height: 24, borderRadius: 14, padding: 3, justifyContent: 'center' },
  toggleThumb: { width: 18, height: 18, borderRadius: 10 },
  durationRow: { flexDirection: 'row', gap: 8, paddingLeft: 44, paddingBottom: 4 },
  durationOption: { minWidth: 52, paddingVertical: 7, paddingHorizontal: 8, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  durationText: { fontSize: 10, fontWeight: '700' },
  difficultyHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4 },
  difficultyLabel: { fontSize: 11, fontWeight: '600' },
  difficultyValue: { fontSize: 11, fontWeight: '700' },
  difficultyRow: { flexDirection: 'row', gap: 5 },
  difficultyOption: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  difficultyOptionText: { fontSize: 9, fontWeight: '700' },
  footerNote: { textAlign: 'center', fontSize: 11, paddingTop: 3 },
  gameContent: { paddingHorizontal: 18, gap: 14 },
  gameHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gameHeaderActions: { flexDirection: 'row', gap: 7 },
  gameHeaderCenter: { alignItems: 'center' },
  gameTitle: { fontSize: 18, fontWeight: '700', marginTop: 3 },
  playerNotice: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderRadius: 12, paddingVertical: 8 },
  playerNoticeText: { fontSize: 11, fontWeight: '600' },
  clocksRow: { flexDirection: 'row', gap: 9 },
  clockCard: { flex: 1, borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  clockIdentity: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  clockDot: { width: 8, height: 8, borderRadius: 5, borderWidth: 1 },
  clockName: { fontSize: 10, fontWeight: '700' },
  clockValue: { fontSize: 24, fontWeight: '700', letterSpacing: 0.5 },
  turnCard: { borderWidth: 1, borderRadius: 18, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 11 },
  turnMark: { width: 42, height: 42, borderRadius: 13, justifyContent: 'center', alignItems: 'center' },
  turnPiece: { fontSize: 28, lineHeight: 34 },
  turnCopy: { flex: 1 },
  turnLabel: { fontSize: 11 },
  turnName: { fontSize: 15, fontWeight: '700', marginTop: 2 },
  turnStatus: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  checkText: { fontSize: 12, fontWeight: '700' },
  turnDot: { width: 9, height: 9, borderRadius: 10 },
  engineStatus: { borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 8 },
  engineStatusText: { fontSize: 11, fontWeight: '600' },
  boardShell: { alignItems: 'center', paddingVertical: 3 },
  boardFrame: { padding: 10, borderRadius: 17, flexDirection: 'row', position: 'relative' },
  rankLabels: { width: 15, justifyContent: 'space-around', alignItems: 'center', paddingVertical: 1 },
  fileLabels: { position: 'absolute', bottom: 0, left: 25, right: 10, height: 12, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end' },
  coordinate: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
  board: { flexDirection: 'row', flexWrap: 'wrap', overflow: 'hidden', borderRadius: 3 },
  square: { width: '12.5%', height: '12.5%', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  piece: { fontSize: 35, lineHeight: 40, textShadowOffset: { width: 1, height: 2 }, textShadowRadius: 1, fontWeight: '400' },
  moveMarker: { width: 10, height: 10, borderRadius: 10, position: 'absolute', opacity: 0.82 },
  captureMarker: { width: '72%', height: '72%', borderRadius: 2, backgroundColor: 'transparent', borderWidth: 2 },
  promotionCard: { borderWidth: 1, borderRadius: 18, padding: 14, gap: 12 },
  promotionCopy: { gap: 3 },
  promotionTitle: { fontSize: 14, fontWeight: '700' },
  promotionSubtitle: { fontSize: 11 },
  promotionOptions: { flexDirection: 'row', gap: 7 },
  promotionOption: { flex: 1, minHeight: 70, borderWidth: 1, borderRadius: 13, alignItems: 'center', justifyContent: 'center', gap: 2 },
  promotionPiece: { fontSize: 29, lineHeight: 33 },
  promotionLabel: { fontSize: 9, fontWeight: '700' },
  gameActions: { flexDirection: 'row', gap: 8 },
  secondaryActions: { flexDirection: 'row', justifyContent: 'center', gap: 12 },
  adBanner: { minHeight: 34, borderWidth: 1, borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  adBannerText: { fontSize: 10 },
  button: { flex: 1, minHeight: 45, paddingHorizontal: 8, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  buttonText: { fontSize: 12, fontWeight: '700' },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
  resultCard: { borderRadius: 18, padding: 16, flexDirection: 'row', gap: 12, alignItems: 'center' },
  resultCopy: { flex: 1 },
  resultTitle: { fontSize: 14, fontWeight: '700' },
  resultText: { fontSize: 11, marginTop: 4 },
  movesHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 },
  movesHeadingText: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  countBadge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: 11, fontWeight: '700' },
  movesList: { borderWidth: 1, borderRadius: 16, padding: 11, gap: 9 },
  moveRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  moveNumber: { width: 18, fontSize: 11, textAlign: 'center' },
  moveText: { flex: 1, fontSize: 12, fontWeight: '600' },
  emptyMoves: { fontSize: 12, textAlign: 'center', paddingVertical: 8 },
  materialNote: { fontSize: 10, textAlign: 'center' },
});