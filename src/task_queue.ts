/**
 * Created by taozeyu on 2017/3/14.
 */

export type Task = () => void;

export class TaskQueue {

    private queue: Task[] = [];
    private anyMethodNotReturn: boolean = false;

    public run(task: Task): void {
        if (this.anyMethodNotReturn) {
            this.queue.unshift(task);
            return;
        }
        this.anyMethodNotReturn = true;
        this.callTask(task);
        // the task might call run method before it return.
        let t: Task | undefined;
        while (t = this.queue.pop()) {
            this.callTask(t);
        }
        this.anyMethodNotReturn = false;
    }

    private callTask(task: Task): void {
        try {
            task();
        } catch (err) {
            console.error(err);
        }
    }
}

const taskQueue = new TaskQueue();
export default taskQueue;