# History

## Undo and redo

Every change is one step: an edit, a signature, a thread message, a resolved thread, a write of the coding agent, a restore, an import, and opening a project changed outside Requireganizer. Undo, redo and going to a step are not steps: they move the project within its history, and none of them makes an automatic restore point. One history covers the whole project, across its modules, and survives closing and opening Requireganizer again.

Undo goes back one step at a time along the steps that led to the project as it is now. Redo goes forward, oldest first, along the steps after the current one that the project was most recently at, so after going to an earlier step it follows the branch the project was last on. The list of steps goes to any kept step, on any branch, or to how the project was before the oldest of them, and shows each step newest first with who made it, what kind of change it was and whether it led to the project as it is now, and which of them, or the state before them, the project is at. Going to a step leaves the focus where it is.

## Focus after undo and redo

Each step records where your focus was when it was made, where the change moved it, and, for a change of the coding agent, what it named for your attention. Undo puts the focus on the first item, coverage or impact the change was made on that still exists, else where it was when the change was made. Redo puts it where the change moved it, else on the first unit the change was made on; for the coding agent's change, on what it named, else it leaves the focus where it is. A unit that no longer exists gives way to the next of its stage, else the previous, else the stage. Its module and stage show, with it in view.

## Restore points

A restore point is made when you ask, under the name you give, and automatically before a change when none was made in the hour before. Automatic restore points thin out with age: every one from the last 48 hours, then the newest of each day for a week, of each ISO week, starting on Monday, for two months, of each month for a year, and of each year, counted in your time zone. Pinned ones, and those you made, stay until you delete them. A restore point exports to a file that import accepts.

## Preview

The list of steps shows what each step added, changed or removed, item by item, coverage by coverage and impact by impact, and each thread on a removed item it changed, by what that item said. Pointing at or focusing "Go to" on a step, or "Restore" on a restore point, shows what bringing that state back would add, change or remove. Both comparisons count a change to a signature, to a thread or to an item's place in its stage as a change to its unit. A preview shows an earlier state read only, with the same stages, modules and threads, and marks each unit that bringing it back would add, change or remove, showing what differs and showing a unit it would remove where the project holds it now. Keys move from one mark to the next or the previous across stages and modules. Each preview has an address of its own, which survives a reload and which back and forward reach; an address of a state no longer kept shows the project as it is now, with a message.

## Code

The history lives in `app/history/`. It depends on storage, never the reverse: storage keeps the history whole in the project's record beside the states last written, and never reads it.
