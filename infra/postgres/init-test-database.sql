-- The integration suites run against a disposable database whose name the
-- guards expect (`/middleware_test`). POSTGRES_DB only creates one database, so
-- the test database is created here, on first start of an empty volume.
CREATE DATABASE middleware_test OWNER middleware;
