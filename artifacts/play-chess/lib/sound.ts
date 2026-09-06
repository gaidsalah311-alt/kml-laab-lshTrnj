import { createAudioPlayer } from 'expo-audio';

export type SoundEvent = 'move' | 'capture' | 'check' | 'gameOver' | 'error';

const SOUND_WAV = 'data:audio/wav;base64,UklGRlQCAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YTACAACAjpmip6ejmo+BdGhfWlldZXF+i5egpaajm5CEd2thXFpdZW97iJSdo6WinJKGeW1kXlxeZGx3g4+Yn6KhnJSKfnJpYl5fZGt2gYyWnaGhnJWLgHVrZGBgZGt0f4qUm5+gnJaNgnduZmJhZGpzfYiRmZ2fnJaOhHlwaGNiZGpye4aPl5ydm5aPhXtyamVjZWlxeoSNlZqcm5eQh310bWdlZmlweIKLkpibmpaQiH92b2lmZmpwd4CJkJaZmZaRiYF4cWtoZ2pvdn6HjpSXmJaRioJ6c21paWtvdX2FjJKWl5WRi4R8dW9ramtvdXyDipCUlZSRi4V9dnFta2xvdHuCiY6SlJSRjIZ/eHNubW1wdHqBh42Rk5OQjIaAenRwbm5wdHl+hImNkJCPjIeCfXh0cXBydHl+g4iMjo+Oi4iDfnl1c3JydXh9goaKjY6Ni4iDf3p3dHNzdXh8gYWJi4yMioeEgHx4dnR0dnl8gISHiouLioeEgH15d3Z2d3l8f4OGiIqKiYeEgX57eHd3eHl8f4KFh4iIiIaEgX58enl4eXp8f4GEhoeHh4aEgn99e3p5ent8foGDhIWGhoWDgoB+fHt7e3x9foCCg4SFhISDgYB/fXx8fH19f4CBgoODg4OCgYB/fn59fX5+f4CBgYKCgoKBgYCAf39/f39/f4CAgIGBgYGAgICAgICAgA==';

const players: Partial<Record<SoundEvent, ReturnType<typeof createAudioPlayer>>> = {};

export function playSound(event: SoundEvent, enabled: boolean) {
  if (!enabled) return;
  try {
    const player = players[event] ?? createAudioPlayer(SOUND_WAV);
    players[event] = player;
    player.seekTo(0);
    player.volume = event === 'gameOver' ? 0.8 : 0.35;
    player.play();
  } catch {
    // Audio is an enhancement; a failed audio session must never interrupt a game.
  }
}

export function releaseSounds() {
  Object.values(players).forEach((player) => player?.remove());
}