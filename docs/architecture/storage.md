# Storage

## Where a project lives

A project lives in a file or in the browser. A project in a file keeps everything except its history and restore points in that one file, which the project server writes so that it changes only in the lines that hold what changed. Its record, which holds the history, lives in the state directory, under `requireganizer/projects/`. A project in the browser keeps everything, history included, in the browser's own storage.

Each change is written as it is made. A failed write is shown at once with what to do, and stays shown until a later write succeeds.

## Outside changes

When the stored project changes or is removed outside Requireganizer, such as by checking out another branch, Requireganizer says so, while the project is open or when it is next opened, and writes nothing over it until you choose. A changed project can be opened, or the project on screen written over it; a project that cannot be opened says why. A removed project can be written back or left removed.

## Export and import

An export is one file holding every module with its items, codes, coverages, impacts, signatures and threads, and never the history or restore points. It can leave out threads, or keep only the open ones, drop the times of thread messages, and keep signatures with or without their times, or none. Two exports with the same options differ only in the lines that changed between them.

Import replaces the open project, or adds a new one, with exactly what the file holds. A file no export could have written is refused with what is wrong with it.
