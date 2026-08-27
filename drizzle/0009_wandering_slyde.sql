CREATE TRIGGER task_dependency_prevent_cycle_insert
BEFORE INSERT ON task_dependency
BEGIN
    SELECT RAISE(
        ABORT,
        'circular dependency: a task cannot depend on itself'
    )
    WHERE NEW.task_id = NEW.dependency_id;

    SELECT RAISE(
        ABORT,
        'circular dependency detected'
    )
    WHERE EXISTS (
        SELECT 1
        FROM (
            WITH RECURSIVE reachable(id) AS (
                SELECT dependency_id
                FROM task_dependency
                WHERE task_id = NEW.dependency_id

                UNION

                SELECT edge.dependency_id
                FROM task_dependency AS edge
                INNER JOIN reachable
                    ON edge.task_id = reachable.id
            )
            SELECT id
            FROM reachable
        )
        WHERE id = NEW.task_id
    );
END;


CREATE TRIGGER task_dependency_prevent_cycle_update
BEFORE UPDATE OF task_id, dependency_id ON task_dependency
BEGIN
    SELECT RAISE(
        ABORT,
        'circular dependency: a task cannot depend on itself'
    )
    WHERE NEW.task_id = NEW.dependency_id;

    SELECT RAISE(
        ABORT,
        'circular dependency detected'
    )
    WHERE EXISTS (
        SELECT 1
        FROM (
            WITH RECURSIVE reachable(id) AS (
                SELECT dependency_id
                FROM task_dependency
                WHERE task_id = NEW.dependency_id
                  AND NOT (
                      task_id = OLD.task_id
                      AND dependency_id = OLD.dependency_id
                  )

                UNION

                SELECT edge.dependency_id
                FROM task_dependency AS edge
                INNER JOIN reachable
                    ON edge.task_id = reachable.id
                WHERE NOT (
                    edge.task_id = OLD.task_id
                    AND edge.dependency_id = OLD.dependency_id
                )
            )
            SELECT id
            FROM reachable
        )
        WHERE id = NEW.task_id
    );
END;