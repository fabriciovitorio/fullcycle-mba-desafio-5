#!/usr/bin/env python3
"""Keep an ordered Codex SI task list; progress.md remains the resume authority."""
import argparse
import json
import os
from pathlib import Path
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--file', type=Path, required=True)
    commands = parser.add_subparsers(dest='command', required=True)
    create = commands.add_parser('create')
    create.add_argument('--id', required=True)
    create.add_argument('--subject', required=True)
    create.add_argument('--description', required=True)
    create.add_argument('--active-form', required=True)
    update = commands.add_parser('update')
    update.add_argument('--id', required=True)
    update.add_argument('--status', choices=['pending', 'in_progress', 'completed'], required=True)
    commands.add_parser('list')
    get = commands.add_parser('get')
    get.add_argument('--id', required=True)
    args = parser.parse_args()

    try:
        if args.file.is_symlink():
            raise ValueError('Task file must not be a symbolic link')
        if args.file.exists():
            document = json.loads(args.file.read_text())
        elif args.command == 'create':
            document = {'schema_version': 1, 'tasks': []}
        else:
            raise ValueError('Task file does not exist; create the SI list first')
        if not isinstance(document, dict) or document.get('schema_version') != 1 or not isinstance(document.get('tasks'), list):
            raise ValueError('Unsupported or malformed task file')
        tasks = document['tasks']
        ids = set()
        for task in tasks:
            if not isinstance(task, dict) or not all(isinstance(task.get(k), str) and task[k].strip() for k in ['id', 'subject', 'description', 'activeForm']):
                raise ValueError('Malformed SI contract')
            if task.get('status') not in ['pending', 'in_progress', 'completed'] or task['id'] in ids:
                raise ValueError('Malformed or duplicate SI state')
            ids.add(task['id'])
        current = next((task for task in tasks if task['id'] == getattr(args, 'id', None)), None)
        changed = False
        if args.command == 'create':
            task = {'id': args.id, 'subject': args.subject, 'description': args.description,
                    'activeForm': args.active_form, 'status': 'pending'}
            if not all(task[key].strip() for key in ['id', 'subject', 'description', 'activeForm']):
                raise ValueError('SI fields must be nonempty')
            if current is None:
                tasks.append(task)
                current = task
                changed = True
            elif any(current[key] != task[key] for key in ['subject', 'description', 'activeForm']):
                raise ValueError('SI already exists with a different contract; reconcile it explicitly')
        elif args.command in ['update', 'get']:
            if current is None:
                raise ValueError(f'Unknown SI: {args.id}')
            if args.command == 'update':
                current['status'] = args.status
                changed = True

        if changed:
            # Workflow calls are sequential, one SI per operation. Atomic replacement
            # prevents a partial JSON file if the process is interrupted.
            args.file.parent.mkdir(parents=True, exist_ok=True)
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=args.file.parent,
                                                 prefix='.codex-si-', delete=False) as handle:
                    temporary = Path(handle.name)
                    json.dump(document, handle, ensure_ascii=False, indent=2)
                    handle.write('\n')
                    handle.flush()
                    os.fsync(handle.fileno())
                temporary.replace(args.file)
            finally:
                if temporary is not None and temporary.exists():
                    temporary.unlink()
        print(json.dumps(document if args.command == 'list' else current, ensure_ascii=False, indent=2))
    except (OSError, ValueError, TypeError, KeyError) as error:
        parser.exit(1, f'SI_TASK_ERROR: {error}\n')


if __name__ == '__main__':
    main()
