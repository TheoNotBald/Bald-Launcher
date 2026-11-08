package bl.event;

public interface Listener<T> {
    void accept(T event);
}
