package bl.event.events;

public final class AttackEvent {

    public final Object target;

    public AttackEvent(Object target) {
        this.target = target;
    }
}
