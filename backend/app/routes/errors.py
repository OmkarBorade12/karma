"""Shared API error type — carries an HTTP status (validation 400s etc.)."""


class KarmaError(Exception):
    def __init__(self, message: str, status: int = 500):
        super().__init__(message)
        self.status = status
