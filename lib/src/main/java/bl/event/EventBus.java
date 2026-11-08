package bl.event;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import bl.Bl;
import bl.module.Module;

public final class EventBus {

    private record Subscription(Module owner, Listener<?> listener) {
    }

    private final Map<Class<?>, List<Subscription>> listeners = new HashMap<>();

    public <T> void subscribe(Class<T> type, Listener<T> listener) {
        subscribe(null, type, listener);
    }

    public <T> void subscribe(Module owner, Class<T> type, Listener<T> listener) {
        listeners.computeIfAbsent(type, key -> new ArrayList<>()).add(new Subscription(owner, listener));
    }

    public <T> void post(T event) {
        List<Subscription> bucket = listeners.get(event.getClass());
        if (bucket == null || bucket.isEmpty()) {
            return;
        }
        for (Subscription subscription : new ArrayList<>(bucket)) {
            try {
                @SuppressWarnings("unchecked")
                Listener<T> listener = (Listener<T>) subscription.listener();
                listener.accept(event);
            } catch (Throwable t) {
                if (subscription.owner() == null) {
                    Bl.fault(t);
                } else {
                    subscription.owner().fail(t);
                }
            }
        }
    }
}
