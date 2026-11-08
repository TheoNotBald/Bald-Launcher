package bl.event.events;

public final class BlockQueryEvent {

    public final Object level;
    public final Object pos;

    public BlockQueryEvent(Object level, Object pos) {
        this.level = level;
        this.pos = pos;
    }
}
