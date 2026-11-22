"""Callback data is ``<prefix>:<fields>`` with digits only for ids, matched by strict regexes in the handlers;
anything else falls through to the "stale button" answer. Nothing in callback data is trusted for authorization:
the service re-checks every action against the caller's Telegram id. demo/bot.js speaks the same format."""

from __future__ import annotations

from aiogram.fsm.state import State, StatesGroup

N = r"(\d{1,9})"
PAGE = 8


class Flow(StatesGroup):
    wish = State()
    door_code = State()
    add_name = State()
    add_group = State()
    import_csv = State()
    broadcast = State()
    location = State()
    new_names = State()
    new_date = State()
    new_time = State()
    new_venue = State()
    new_address = State()
    new_capacity = State()
