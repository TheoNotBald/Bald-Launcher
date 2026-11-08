package bl.event.events;

public final class UseItemEvent {

    public final Object hand;
    public final Object hitResult;

    public UseItemEvent(Object hand, Object hitResult) {
        this.hand = hand;
        this.hitResult = hitResult;
    }
}
