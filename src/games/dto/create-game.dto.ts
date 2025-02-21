export class CreateGameDto {
  player1Id: string;
  gameMode: 'friend';
  availableSeats: number[];
}
