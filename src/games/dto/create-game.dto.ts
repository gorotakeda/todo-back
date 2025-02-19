export class CreateGameDto {
  player1Id: string;
  gameMode: 'cpu' | 'friend';
  availableSeats: number[];
}
