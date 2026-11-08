package bl.event.events;

public final class SendPacketEvent {

    public final Object connection;
    public Object packet;
    public boolean cancelled;

    public SendPacketEvent(Object connection, Object packet) {
        this.connection = connection;
        this.packet = packet;
    }

    public void cancel() {
        cancelled = true;
    }
}
