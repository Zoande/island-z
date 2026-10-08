/** Browser clients may initiate WebSocket.close only with 1000 or 3000-4999. */
export const RECONNECT_CLOSE_CODE = 4001;

/** Ask the browser to reconnect and resynchronize after local backpressure. */
export function closeForReconnect(socket: Pick<WebSocket, 'close'> | undefined, reason: string): void {
  socket?.close(RECONNECT_CLOSE_CODE, reason);
}
