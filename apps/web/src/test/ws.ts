// Фейковый WebSocket-клиент для тестов экранов: отправленные команды — в `sent`, сообщения сервера — `emit`.
import type { ClientMessage, ServerMessage } from "@chezz/protocol";
import { act } from "react";
import type { WsClient, WsStatus } from "../shared/api/ws.ts";

export class FakeWsClient implements WsClient {
  status: WsStatus = "open";
  readonly sent: ClientMessage[] = [];
  reconnects = 0;
  private readonly messageFns = new Set<(m: ServerMessage) => void>();
  private readonly statusFns = new Set<(s: WsStatus) => void>();
  private readonly welcomeFns = new Set<() => void>();
  private readonly sessionFns = new Set<() => void>();

  start(): void {}
  close(): void {}
  reconnect(): void {
    this.reconnects += 1;
  }
  send(message: ClientMessage): boolean {
    if (this.status !== "open") return false;
    this.sent.push(message);
    return true;
  }
  onMessage(fn: (m: ServerMessage) => void): () => void {
    this.messageFns.add(fn);
    return () => this.messageFns.delete(fn);
  }
  onStatus(fn: (s: WsStatus) => void): () => void {
    this.statusFns.add(fn);
    return () => this.statusFns.delete(fn);
  }
  onWelcome(fn: () => void): () => void {
    this.welcomeFns.add(fn);
    return () => this.welcomeFns.delete(fn);
  }
  onSessionClosed(fn: () => void): () => void {
    this.sessionFns.add(fn);
    return () => this.sessionFns.delete(fn);
  }

  /** Сообщение сервера всем подписчикам. */
  async emit(message: ServerMessage): Promise<void> {
    await act(async () => {
      for (const fn of [...this.messageFns]) fn(message);
    });
  }
  async setStatus(status: WsStatus): Promise<void> {
    await act(async () => {
      this.status = status;
      for (const fn of [...this.statusFns]) fn(status);
      if (status === "open") for (const fn of [...this.welcomeFns]) fn();
    });
  }
  async sessionClosed(): Promise<void> {
    await act(async () => {
      for (const fn of [...this.sessionFns]) fn();
    });
  }
}
