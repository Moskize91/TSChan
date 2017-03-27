/**
 * Created by taozeyu on 2017/3/14.
 */

import taskQueue from "./task_queue";

export interface ReadonlyChannel<T> {
    readable(): boolean;
    readSync(): T | undefined;
    readAsync(): Promise<T>;
    close(reason?: any): void;
}

export interface WriteonlyChannel<T> {
    writeable(): boolean;
    writeSync(target: T): void;
    writeAsync(target: T): Promise<undefined>;
    startWritingOperationAsync(): Promise<{write: (target: T) => void}>;
    close(reason?: any): void;
}

export interface Channel<T> extends ReadonlyChannel<T>, WriteonlyChannel<T> {}

export const BufferedChannel_Infinite = -1;
export type BufferedChannel_WriteOperation<T> = {
    write: (target: T) => void;
    sendBack: (target: T) => void;
};

type BufferedChannelConsumer<T> = {
    resolve: (target: T) => void,
    reject: (reason?: any) => void,
};

export class BufferedChannel<T> implements Channel<T> {

    private queue: T[] = [];
    private closed: boolean = false;
    private isHandingCounteracting: boolean = false;
    private readyForCounteract: boolean = false;
    private readConsumers: BufferedChannelConsumer<T>[] = [];
    private writeConsumers: BufferedChannelConsumer<BufferedChannel_WriteOperation<T>>[] = [];

    private writeOperation: BufferedChannel_WriteOperation<T> = {
        write: (target: T) => {
            this.writeSync(target);
        },
        sendBack: (target: T) => {
            this.sendBackSync(target);
        },
    };

    public constructor(
        private bufferSize: number = BufferedChannel_Infinite,
        private channelName: string = "unnamed buffered channel",
    ) {}

    public readable(): boolean {
        return !this.closed && this.readableSize() > 0;
    }

    public writeable(): boolean {
        return !this.closed && this.writableSize() > 0;
    }

    public readSync(): T | undefined {
        this.checkDidClosed();
        return this.queue.pop();
    }

    public writeSync(target: T): void {
        this.checkDidClosed();
        if (!this.writeable()) {
            throw new Error(`the channel "${this.channelName}" is full of buffer.`);
        }
        this.queue.unshift(target);
    }

    public sendBackSync(target: T): void {
        this.checkDidClosed();
        if (!this.writeable()) {
            throw new Error(`the channel "${this.channelName}" is full of buffer.`);
        }
        this.queue.push(target);
    }

    public readAsync(): Promise<T> {
        this.checkDidClosed();
        return new Promise<T>((resolve, reject) => {
            this.readConsumers.unshift({resolve, reject});
            this.checkAndTryCounteract();
        });
    }

    public writeAsync(target: T): Promise<undefined> {
        return this.startWritingOperationAsync().then(operation => {
            operation.write(target);
        });
    }

    public sendBackAsync(target: T): Promise<undefined> {
        return this.startWritingOperationAsync().then(operation => {
            operation.sendBack(target);
        });
    }

    public startWritingOperationAsync(): Promise<BufferedChannel_WriteOperation<T>> {
        this.checkDidClosed();
        return new Promise<BufferedChannel_WriteOperation<T>>((resolve, reject) => {
            this.writeConsumers.unshift({resolve, reject});
            this.checkAndTryCounteract();
        });
    }

    private readableSize(): number {
        let size = this.queue.length;
        if (this.isHandingCounteracting) {
            size += this.writeConsumers.length;
        }
        return size;
    }

    private writableSize(): number {
        let size: number = this.bufferSize - this.queue.length;
        if (this.isHandingCounteracting) {
            size += this.readConsumers.length;
        }
        return size;
    }

    public close(reason?: any): void {
        this.checkDidClosed();
        this.closed = true;
        const closeReason = reason || new Error(`the channel "${this.channelName}" was closed.`);
        const rejectBlockedConsumer = (consumer: BufferedChannelConsumer<any>): void => {
            consumer.reject(closeReason);
        };
        this.readConsumers.forEach(rejectBlockedConsumer);
        this.writeConsumers.forEach(rejectBlockedConsumer);

        this.readConsumers = [];
        this.writeConsumers = [];
    }

    private checkDidClosed(): void {
        if (this.closed) {
            throw new Error(`the channel "${this.channelName}" was closed.`);
        }
    }

    private checkAndTryCounteract(): void {
        if (this.readyForCounteract) {
            return;
        }
        this.isHandingCounteracting = true;
        if ((this.writeConsumers.length > 0 && this.readableSize() > 0) ||
            (this.readConsumers.length > 0 && this.writableSize() > 0)) {

            this.readyForCounteract = true;

            taskQueue.run(() => {
                this.isHandingCounteracting = true;

                let canConsumeWriting: boolean;
                let canConsumeReading: boolean;
                do {
                    canConsumeWriting = this.writeConsumers.length > 0 && this.readableSize() > 0;
                    canConsumeReading = this.readConsumers.length > 0 && this.writableSize() > 0;

                    if (canConsumeWriting) {
                        this.consumeWriting();
                    }
                    if (canConsumeReading) {
                        this.consumeReading();
                    }
                } while (canConsumeWriting || canConsumeReading);

                this.readyForCounteract = false;
                this.isHandingCounteracting = false;
            });
        }
        this.isHandingCounteracting = false;
    }

    private consumeWriting(): void {
        const writeConsumer = this.writeConsumers.pop();
        if (writeConsumer) {
            writeConsumer.resolve(this.writeOperation);
        }
    }

    private consumeReading(): void {
        if (this.queue.length < 0) {
            // waiting for next write consumer to write some elements.
            return;
        }
        const readConsumer = this.readConsumers.pop();
        const target = this.queue.pop();
        if (readConsumer) {
            readConsumer.resolve(target as T);
        }
    }
}