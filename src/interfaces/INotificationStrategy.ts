export interface INotificationStrategy<T> {
  /**
   * Sends a message.
   * @param message The message to be sent
   * @param options Optional. Additional options for sending the message (e.g., metadata, priority)
   * @returns A promise that resolves when the message is sent successfully
   */
  send(message: any, options?: Record<string, any>): Promise<void>;

  /**
   * Initializes the notification strategy, if needed.
   * @returns A promise that resolves when initialization is complete
   */
  initialize?(): Promise<void>;

  /**
   * Closes the notification strategy, releasing any resources if necessary.
   * @returns A promise that resolves when the strategy is successfully closed
   */
  close?(): Promise<void>;
}

// Bindable Notification Strategy Interface
export interface IBindableNotificationStrategy<T>
  extends INotificationStrategy<T> {
  bindToAddress(address: string): IBindableNotificationStrategy<T>;
}

export interface ChannelBinding<T> {
  send: (message: T) => Promise<void>;
  unsubscribe: () => Promise<void>;
}
